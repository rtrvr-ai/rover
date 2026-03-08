/**
 * Task State Machine — enforced transitions for task lifecycle.
 *
 * States: idle → running → awaiting_user → paused → blocked → completed → failed → cancelled
 *
 * All transitions are explicit. Invalid transitions are rejected (never silently applied).
 */

import type { TaskState, TaskRecord, PersistedTaskTabScope } from './runtimeTypes.js';

// ── Event types ──────────────────────────────────────────────────────

export type TaskEvent =
  | { type: 'START'; reason?: string; taskId?: string }
  | { type: 'AGENT_PROGRESS'; ts?: number }
  | { type: 'NAVIGATION_STARTED'; targetUrl: string; isCrossHost: boolean }
  | { type: 'NAVIGATION_COMPLETED'; url: string }
  | { type: 'ASK_USER'; questions?: unknown[] }
  | { type: 'PAUSE'; reason?: string }
  | { type: 'RESUME' }
  | { type: 'BLOCK'; reason?: string }
  | { type: 'UNBLOCK' }
  | { type: 'COMPLETE'; summary?: string }
  | { type: 'FAIL'; error?: string }
  | { type: 'CANCEL'; reason?: string }
  | { type: 'RESET'; reason?: string }
  | { type: 'USER_RESPONDED' };

// ── Side effects ─────────────────────────────────────────────────────

export type TaskSideEffect =
  | { kind: 'create_task' }
  | { kind: 'rotate_boundary' }
  | { kind: 'assign_worker' }
  | { kind: 'release_worker' }
  | { kind: 'clear_run' }
  | { kind: 'clear_worker_state' }
  | { kind: 'snapshot_worker_state' }
  | { kind: 'restore_snapshot' }
  | { kind: 'set_pending_questions'; questions: unknown[] }
  | { kind: 'clear_questions' }
  | { kind: 'archive_task' }
  | { kind: 'emit_error'; error?: string }
  | { kind: 'record_block_reason'; reason?: string }
  | { kind: 'notify_agent_blocked' }
  | { kind: 'resume_from_block' }
  | { kind: 'update_timestamps'; ts: number }
  | { kind: 'record_navigation'; targetUrl: string; isCrossHost: boolean }
  | { kind: 'clear_navigation' };

// ── Transition result ────────────────────────────────────────────────

export type TaskTransitionResult = {
  /** New state after transition (unchanged if rejected) */
  next: TaskState;
  /** Whether the transition was rejected */
  rejected: boolean;
  /** Reason for rejection (empty if accepted) */
  rejectedReason?: string;
  /** Side effects to execute after transition */
  sideEffects: TaskSideEffect[];
};

// ── Transition table ─────────────────────────────────────────────────

type TransitionEntry = {
  to: TaskState;
  sideEffects: (event: TaskEvent, record?: TaskRecord) => TaskSideEffect[];
};

type TransitionMap = Partial<Record<TaskEvent['type'], TransitionEntry>>;
type FullTransitionTable = Record<TaskState, TransitionMap>;

function startSideEffects(): TaskSideEffect[] {
  return [
    { kind: 'create_task' },
    { kind: 'rotate_boundary' },
    { kind: 'assign_worker' },
  ];
}

function terminalSideEffects(): TaskSideEffect[] {
  return [
    { kind: 'release_worker' },
    { kind: 'clear_run' },
  ];
}

function cancelSideEffects(): TaskSideEffect[] {
  return [
    { kind: 'release_worker' },
    { kind: 'clear_run' },
  ];
}

function resetSideEffects(): TaskSideEffect[] {
  return [
    { kind: 'archive_task' },
    { kind: 'clear_run' },
    { kind: 'clear_worker_state' },
  ];
}

const TRANSITION_TABLE: FullTransitionTable = {
  idle: {
    START: {
      to: 'running',
      sideEffects: () => startSideEffects(),
    },
  },

  running: {
    AGENT_PROGRESS: {
      to: 'running',
      sideEffects: () => [{ kind: 'update_timestamps', ts: Date.now() }],
    },
    NAVIGATION_STARTED: {
      to: 'running',
      sideEffects: (event) => [
        { kind: 'record_navigation', targetUrl: (event as any).targetUrl, isCrossHost: (event as any).isCrossHost },
        { kind: 'update_timestamps', ts: Date.now() },
      ],
    },
    NAVIGATION_COMPLETED: {
      to: 'running',
      sideEffects: () => [
        { kind: 'clear_navigation' },
        { kind: 'update_timestamps', ts: Date.now() },
      ],
    },
    ASK_USER: {
      to: 'awaiting_user',
      sideEffects: (event) => [
        { kind: 'set_pending_questions', questions: (event as any).questions || [] },
      ],
    },
    PAUSE: {
      to: 'paused',
      sideEffects: () => [
        { kind: 'snapshot_worker_state' },
        { kind: 'release_worker' },
      ],
    },
    BLOCK: {
      to: 'blocked',
      sideEffects: (event) => [
        { kind: 'record_block_reason', reason: (event as any).reason },
        { kind: 'notify_agent_blocked' },
      ],
    },
    COMPLETE: {
      to: 'completed',
      sideEffects: () => terminalSideEffects(),
    },
    FAIL: {
      to: 'failed',
      sideEffects: (event) => [
        ...terminalSideEffects(),
        { kind: 'emit_error', error: (event as any).error },
      ],
    },
    CANCEL: {
      to: 'cancelled',
      sideEffects: () => cancelSideEffects(),
    },
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  awaiting_user: {
    USER_RESPONDED: {
      to: 'running',
      sideEffects: () => [{ kind: 'clear_questions' }],
    },
    PAUSE: {
      to: 'paused',
      sideEffects: () => [
        { kind: 'snapshot_worker_state' },
        { kind: 'release_worker' },
      ],
    },
    CANCEL: {
      to: 'cancelled',
      sideEffects: () => cancelSideEffects(),
    },
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  paused: {
    RESUME: {
      to: 'running', // Caller must check prePauseState to decide running vs awaiting_user
      sideEffects: () => [
        { kind: 'restore_snapshot' },
        { kind: 'assign_worker' },
      ],
    },
    CANCEL: {
      to: 'cancelled',
      sideEffects: () => cancelSideEffects(),
    },
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  blocked: {
    UNBLOCK: {
      to: 'running',
      sideEffects: () => [{ kind: 'resume_from_block' }],
    },
    CANCEL: {
      to: 'cancelled',
      sideEffects: () => cancelSideEffects(),
    },
    FAIL: {
      to: 'failed',
      sideEffects: (event) => [
        ...terminalSideEffects(),
        { kind: 'emit_error', error: (event as any).error },
      ],
    },
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  completed: {
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  failed: {
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },

  cancelled: {
    RESET: {
      to: 'idle',
      sideEffects: () => resetSideEffects(),
    },
  },
};

// ── Reducer ──────────────────────────────────────────────────────────

/**
 * Pure reducer: given a current state + event, returns the next state and side effects.
 * Invalid transitions are rejected (next === current, rejected === true).
 */
export function reduceTaskState(
  current: TaskState,
  event: TaskEvent,
  record?: TaskRecord,
): TaskTransitionResult {
  const stateTransitions = TRANSITION_TABLE[current];
  const entry = stateTransitions?.[event.type];

  if (!entry) {
    return {
      next: current,
      rejected: true,
      rejectedReason: `Invalid transition: ${current} + ${event.type}`,
      sideEffects: [],
    };
  }

  let nextState = entry.to;

  // Special case: RESUME from paused checks prePauseState
  if (current === 'paused' && event.type === 'RESUME' && record?.prePauseState === 'awaiting_user') {
    nextState = 'awaiting_user';
  }

  return {
    next: nextState,
    rejected: false,
    sideEffects: entry.sideEffects(event, record),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Check whether a state is terminal (task has ended). */
export function isTerminalState(state: TaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

/** Check whether a state is active (task is doing something). */
export function isActiveState(state: TaskState): boolean {
  return state === 'running' || state === 'awaiting_user' || state === 'blocked';
}

/** Check whether a task can accept new user input. */
export function canAcceptUserInput(state: TaskState): boolean {
  return state === 'idle' || state === 'awaiting_user';
}

/**
 * Backward-compat: map new TaskState to the legacy `status` string used by server/shared state.
 * During migration, the server still uses: running | completed | cancelled | failed | ended.
 */
export function statusFromState(state: TaskState): string {
  switch (state) {
    case 'idle': return 'running'; // idle maps to running for server (no server concept of idle)
    case 'running': return 'running';
    case 'awaiting_user': return 'running'; // server doesn't distinguish awaiting_user
    case 'paused': return 'running'; // server sees paused as still "running"
    case 'blocked': return 'running'; // server sees blocked as still "running"
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'running';
  }
}

/**
 * Human-readable display status for UI-facing code.
 * Unlike `statusFromState` (which maps to legacy server strings), this returns
 * the actual state so the UI never contradicts what the user sees.
 */
export function displayStatus(state: TaskState): string {
  switch (state) {
    case 'idle': return 'idle';
    case 'running': return 'running';
    case 'awaiting_user': return 'awaiting_input';
    case 'paused': return 'paused';
    case 'blocked': return 'blocked';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

/**
 * Map legacy status string to TaskState. Used during v1 → v2 migration.
 * `ended` → `cancelled` (user-initiated end).
 */
export function stateFromLegacyStatus(
  status: string | undefined,
  boundaryReason?: string,
): TaskState {
  if (!status) return 'idle';
  switch (status) {
    case 'running': {
      // Check boundaryReason for awaiting_user (legacy detection)
      const reason = String(boundaryReason || '').trim().toLowerCase();
      if (reason.includes('waiting_for_input') || reason.includes('awaiting_user')) {
        return 'awaiting_user';
      }
      return 'running';
    }
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    case 'ended': return 'cancelled'; // ended maps to cancelled in new model
    default: return 'idle';
  }
}

/**
 * Apply a task event to a TaskRecord, returning the updated record.
 * Does NOT mutate the input record.
 */
export function applyTaskEvent(
  record: TaskRecord,
  event: TaskEvent,
): { record: TaskRecord; result: TaskTransitionResult } {
  const result = reduceTaskState(record.state, event, record);

  if (result.rejected) {
    return { record, result };
  }

  const now = Date.now();
  const updated: TaskRecord = {
    ...record,
    state: result.next,
  };

  // Apply state-specific updates
  if (result.next === 'paused' && !updated.pausedAt) {
    updated.pausedAt = now;
    updated.prePauseState = record.state === 'awaiting_user' ? 'awaiting_user' : 'running';
  }

  if (result.next === 'blocked') {
    updated.blockedAt = now;
    const blockEvent = event as { type: 'BLOCK'; reason?: string };
    updated.blockReason = blockEvent.reason;
  }

  if (result.next === 'running' && record.state === 'paused') {
    // Resumed — clear pause tracking
    updated.pausedAt = undefined;
    updated.prePauseState = undefined;
  }

  if (result.next === 'running' && record.state === 'blocked') {
    // Unblocked — clear block tracking
    updated.blockedAt = undefined;
    updated.blockReason = undefined;
  }

  if (result.next === 'running' && record.state === 'awaiting_user') {
    // User responded — clear pause tracking if any
    updated.pausedAt = undefined;
    updated.prePauseState = undefined;
  }

  if (isTerminalState(result.next)) {
    updated.endedAt = now;
  }

  if (event.type === 'COMPLETE' && (event as any).summary) {
    updated.summary = (event as any).summary;
  }

  if (event.type === 'RESET') {
    // Full reset to idle
    updated.pausedAt = undefined;
    updated.prePauseState = undefined;
    updated.blockedAt = undefined;
    updated.blockReason = undefined;
    updated.endedAt = undefined;
  }

  return { record: updated, result };
}

/**
 * Create a new TaskRecord in idle state.
 */
export function createTaskRecord(overrides?: Partial<TaskRecord>): TaskRecord {
  const now = Date.now();
  const taskId = overrides?.taskId || generateTaskId();
  const boundaryId = overrides?.boundaryId || generateBoundaryId();
  return {
    taskId,
    state: 'idle',
    boundaryId,
    startedAt: now,
    uiMessages: [],
    timeline: [],
    seedChatLog: [],
    tabIds: [],
    ...overrides,
  };
}

/** Generate a unique task ID. */
function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a unique boundary ID. */
function generateBoundaryId(): string {
  return `bnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
