/**
 * TaskOrchestrator — central coordinator managing multiple TaskRecord instances.
 *
 * Replaces scattered task logic in index.ts. Handles multi-task lifecycle,
 * switching, archival, worker assignment, and persistence.
 */

import type {
  TaskState,
  TaskRecord,
  PersistedRuntimeState,
  PersistedUiMessage,
  PersistedTimelineEvent,
  PersistedWorkerState,
  PersistedPendingRun,
  PersistedTaskTabScope,
} from './runtimeTypes.js';
import {
  reduceTaskState,
  applyTaskEvent,
  createTaskRecord,
  isTerminalState,
  isActiveState,
  statusFromState,
  stateFromLegacyStatus,
  type TaskEvent,
  type TaskTransitionResult,
  type TaskSideEffect,
} from './taskStateMachine.js';
import { WorkerPool, type WorkerConfig, type WorkerPoolOptions } from './workerPool.js';

export type TaskOrchestratorOptions = {
  maxConcurrentWorkers?: number;
  maxQueuedTasks?: number;
  maxArchivedTasks?: number;
};

const DEFAULT_MAX_ARCHIVED_TASKS = 10;
const ARCHIVED_MAX_MESSAGES = 20;
const MAX_ACTIVE_TASK_MESSAGES = 50;
const MAX_ACTIVE_TASK_TIMELINE = 30;
const WORKER_INACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const MAX_TABS_FOR_NEW_TASKS = 5;

export type TaskDispatchResult = {
  accepted: boolean;
  task: TaskRecord;
  sideEffects: TaskSideEffect[];
  rejectedReason?: string;
};

export class TaskOrchestrator {
  private tasks: Map<string, TaskRecord> = new Map();
  private activeTaskId: string | undefined;
  private taskOrder: string[] = [];
  private workerPool: WorkerPool;
  private maxArchivedTasks: number;
  private tabToTask: Map<number, string> = new Map(); // tabId → taskId

  constructor(options?: TaskOrchestratorOptions) {
    this.workerPool = new WorkerPool({
      maxWorkers: options?.maxConcurrentWorkers,
      maxQueue: options?.maxQueuedTasks,
      onWorkerFreed: (taskId) => this.onWorkerSlotFreed(taskId),
    });
    this.maxArchivedTasks = Math.max(1, Number(options?.maxArchivedTasks) || DEFAULT_MAX_ARCHIVED_TASKS);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Create a new task and add it to the orchestrator.
   * The task starts in `idle` state. Call `dispatch(taskId, { type: 'START' })` to begin.
   */
  createTask(reason: string, overrides?: Partial<TaskRecord>): TaskRecord {
    const record = createTaskRecord(overrides);
    this.tasks.set(record.taskId, record);
    this.taskOrder.push(record.taskId);
    return record;
  }

  /**
   * Dispatch an event to a specific task's state machine.
   * Returns whether the transition was accepted and the updated task record.
   */
  dispatch(taskId: string, event: TaskEvent): TaskDispatchResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      const empty = createTaskRecord({ taskId });
      return {
        accepted: false,
        task: empty,
        sideEffects: [],
        rejectedReason: `Task ${taskId} not found`,
      };
    }

    const { record: updated, result } = applyTaskEvent(task, event);

    if (!result.rejected) {
      this.tasks.set(taskId, updated);
    }

    return {
      accepted: !result.rejected,
      task: result.rejected ? task : updated,
      sideEffects: result.sideEffects,
      rejectedReason: result.rejectedReason,
    };
  }

  // ── Active task / UI ─────────────────────────────────────────────

  /**
   * Switch the currently active (displayed) task.
   * Returns the task record, or undefined if not found.
   */
  switchActiveTask(taskId: string): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    // Save scroll position of current task
    const current = this.getActiveTask();
    if (current) {
      // Scroll position is set externally via updateScrollPosition
    }

    this.activeTaskId = taskId;
    return task;
  }

  /** Get the currently active task. */
  getActiveTask(): TaskRecord | undefined {
    if (!this.activeTaskId) return undefined;
    return this.tasks.get(this.activeTaskId);
  }

  /** Get the active task ID. */
  getActiveTaskId(): string | undefined {
    return this.activeTaskId;
  }

  /** List all tasks in display order. */
  listTasks(): TaskRecord[] {
    return this.taskOrder
      .map(id => this.tasks.get(id))
      .filter((t): t is TaskRecord => !!t);
  }

  /** Get a specific task by ID. */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /** Check if a task exists. */
  hasTask(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /** Get the total number of tasks. */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /** Update a task record directly (for fields not managed by the FSM). */
  updateTask(taskId: string, updater: (task: TaskRecord) => TaskRecord): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    const updated = updater(task);
    this.tasks.set(taskId, updated);
    return updated;
  }

  /** Save scroll position for a task. */
  updateScrollPosition(taskId: string, position: number): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, scrollPosition: position });
    }
  }

  // ── Worker assignment ────────────────────────────────────────────

  /**
   * Assign a worker to a task. Returns the worker, or null if queued.
   */
  assignWorker(taskId: string, config: WorkerConfig): Worker | null {
    const worker = this.workerPool.acquire(taskId, config);
    if (worker) {
      const task = this.tasks.get(taskId);
      if (task) {
        this.tasks.set(taskId, { ...task, workerId: taskId });
      }
    }
    return worker;
  }

  /** Release a worker from a task. */
  releaseWorker(taskId: string): void {
    this.workerPool.release(taskId);
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, workerId: undefined });
    }
  }

  /** Get the worker for a task. */
  getWorker(taskId: string): Worker | undefined {
    return this.workerPool.getWorker(taskId);
  }

  /** Get queued task IDs. */
  getQueuedTasks(): string[] {
    return this.workerPool.getQueuedTasks();
  }

  /** Check if a task is queued for a worker. */
  isTaskQueued(taskId: string): boolean {
    return this.workerPool.isQueued(taskId);
  }

  private onWorkerSlotFreed(taskId: string): void {
    // A worker slot opened up and a queued task was dequeued.
    // The caller should listen for this and acquire a worker for the task.
  }

  // ── Tab mapping ──────────────────────────────────────────────────

  /** Associate a tab with a task. */
  mapTabToTask(tabId: number, taskId: string): void {
    this.tabToTask.set(tabId, taskId);
    const task = this.tasks.get(taskId);
    if (task && !task.tabIds.includes(tabId)) {
      this.tasks.set(taskId, {
        ...task,
        tabIds: [...task.tabIds, tabId],
      });
    }
  }

  /** Get the task associated with a tab. */
  getTaskForTab(tabId: number): TaskRecord | undefined {
    const taskId = this.tabToTask.get(tabId);
    if (!taskId) return undefined;
    return this.tasks.get(taskId);
  }

  /** Find a task by its boundary ID. */
  getTaskByBoundaryId(boundaryId: string): TaskRecord | undefined {
    for (const task of this.tasks.values()) {
      if (task.boundaryId === boundaryId) return task;
    }
    return undefined;
  }

  // ── Archival ─────────────────────────────────────────────────────

  /**
   * Archive a task: prune its messages and worker state for storage efficiency.
   */
  archiveTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Prune to keep storage lean
    const archived: TaskRecord = {
      ...task,
      uiMessages: task.uiMessages.slice(-ARCHIVED_MAX_MESSAGES),
      timeline: task.timeline.slice(-ARCHIVED_MAX_MESSAGES),
      workerState: undefined, // Don't keep worker state for archived tasks
      pendingRun: undefined,
    };
    this.tasks.set(taskId, archived);

    // Release worker if still held
    this.workerPool.release(taskId);
  }

  /**
   * Prune old archived tasks beyond the max limit.
   * Keeps the most recent tasks by order.
   */
  pruneArchivedTasks(): void {
    const archivedIds: string[] = [];
    for (const id of this.taskOrder) {
      const task = this.tasks.get(id);
      if (task && isTerminalState(task.state)) {
        archivedIds.push(id);
      }
    }

    // Keep only the most recent N archived tasks
    while (archivedIds.length > this.maxArchivedTasks) {
      const oldestId = archivedIds.shift()!;
      this.tasks.delete(oldestId);
      this.taskOrder = this.taskOrder.filter(id => id !== oldestId);
      // Clean up tab mappings
      for (const [tabId, taskId] of this.tabToTask) {
        if (taskId === oldestId) this.tabToTask.delete(tabId);
      }
    }
  }

  /** Delete a task entirely (not just archive). */
  deleteTask(taskId: string): boolean {
    if (!this.tasks.has(taskId)) return false;

    this.workerPool.release(taskId);
    this.tasks.delete(taskId);
    this.taskOrder = this.taskOrder.filter(id => id !== taskId);

    // Clean up tab mappings
    for (const [tabId, tid] of this.tabToTask) {
      if (tid === taskId) this.tabToTask.delete(tabId);
    }

    // If deleted task was active, switch to the most recent task
    if (this.activeTaskId === taskId) {
      this.activeTaskId = this.taskOrder.length > 0 ? this.taskOrder[this.taskOrder.length - 1] : undefined;
    }

    return true;
  }

  // ── Persistence ──────────────────────────────────────────────────

  /** Serialize to a format suitable for PersistedRuntimeState. */
  toPersistedState(): {
    tasks: Record<string, TaskRecord>;
    activeTaskId?: string;
    taskOrder: string[];
  } {
    const tasks: Record<string, TaskRecord> = {};
    for (const [id, task] of this.tasks) {
      tasks[id] = task;
    }
    return {
      tasks,
      activeTaskId: this.activeTaskId,
      taskOrder: [...this.taskOrder],
    };
  }

  /**
   * Restore from persisted state.
   */
  static fromPersistedState(
    data: {
      tasks?: Record<string, TaskRecord>;
      activeTaskId?: string;
      taskOrder?: string[];
    },
    options?: TaskOrchestratorOptions,
  ): TaskOrchestrator {
    const orchestrator = new TaskOrchestrator(options);

    if (data.tasks && typeof data.tasks === 'object') {
      for (const [id, task] of Object.entries(data.tasks)) {
        if (task && typeof task === 'object' && task.taskId) {
          orchestrator.tasks.set(id, task);
          // Rebuild tab mappings
          if (Array.isArray(task.tabIds)) {
            for (const tabId of task.tabIds) {
              orchestrator.tabToTask.set(tabId, id);
            }
          }
        }
      }
    }

    orchestrator.taskOrder = Array.isArray(data.taskOrder)
      ? data.taskOrder.filter(id => orchestrator.tasks.has(id))
      : Array.from(orchestrator.tasks.keys());

    orchestrator.activeTaskId = data.activeTaskId && orchestrator.tasks.has(data.activeTaskId)
      ? data.activeTaskId
      : orchestrator.taskOrder.length > 0 ? orchestrator.taskOrder[orchestrator.taskOrder.length - 1] : undefined;

    return orchestrator;
  }

  /**
   * Migrate from v1 (single-task) persisted state.
   */
  static fromV1State(
    state: PersistedRuntimeState,
    options?: TaskOrchestratorOptions,
  ): TaskOrchestrator {
    const orchestrator = new TaskOrchestrator(options);

    // If there's an active task from v1, migrate it
    if (state.activeTask) {
      const taskState = stateFromLegacyStatus(state.activeTask.status, state.activeTask.boundaryReason);
      const record: TaskRecord = {
        taskId: state.activeTask.taskId,
        state: taskState,
        boundaryId: state.workerState?.taskBoundaryId || state.pendingRun?.taskBoundaryId || `bnd_migrated_${Date.now().toString(36)}`,
        startedAt: state.activeTask.startedAt,
        endedAt: state.activeTask.endedAt,
        lastUserAt: state.activeTask.lastUserAt,
        lastAssistantAt: state.activeTask.lastAssistantAt,
        uiMessages: Array.isArray(state.uiMessages) ? [...state.uiMessages] : [],
        timeline: Array.isArray(state.timeline) ? [...state.timeline] : [],
        workerState: state.workerState ? { ...state.workerState } : undefined,
        pendingRun: state.pendingRun ? { ...state.pendingRun } : undefined,
        tabScope: state.taskTabScope ? { ...state.taskTabScope } : undefined,
        rootUserInput: state.workerState?.rootUserInput,
        tabIds: state.taskTabScope?.touchedTabIds ? [...state.taskTabScope.touchedTabIds] : [],
      };

      orchestrator.tasks.set(record.taskId, record);
      orchestrator.taskOrder.push(record.taskId);
      orchestrator.activeTaskId = record.taskId;

      // Rebuild tab mappings
      for (const tabId of record.tabIds) {
        orchestrator.tabToTask.set(tabId, record.taskId);
      }
    }

    return orchestrator;
  }

  // ── Crash prevention guardrails ──────────────────────────────────

  /**
   * Enforce per-task memory caps to prevent accumulation from crashing browser.
   * Should be called periodically (e.g. after each state persist).
   */
  enforceMemoryCaps(): void {
    for (const [, task] of this.tasks) {
      if (isTerminalState(task.state)) continue;
      if (task.uiMessages.length > MAX_ACTIVE_TASK_MESSAGES) {
        task.uiMessages = task.uiMessages.slice(-MAX_ACTIVE_TASK_MESSAGES);
      }
      if (task.timeline.length > MAX_ACTIVE_TASK_TIMELINE) {
        task.timeline = task.timeline.slice(-MAX_ACTIVE_TASK_TIMELINE);
      }
    }
  }

  /**
   * Terminate workers for tasks paused longer than the inactivity timeout.
   * Snapshots worker state before termination to allow later resume.
   */
  terminateInactiveWorkers(): string[] {
    const now = Date.now();
    const terminated: string[] = [];
    for (const [taskId, task] of this.tasks) {
      if (task.state !== 'paused') continue;
      const pausedDuration = now - (task.pausedAt || now);
      if (pausedDuration > WORKER_INACTIVITY_TIMEOUT_MS && this.workerPool.getWorker(taskId)) {
        this.workerPool.release(taskId);
        terminated.push(taskId);
      }
    }
    return terminated;
  }

  /**
   * Check if new tasks can be created based on total tab count.
   * With > MAX_TABS_FOR_NEW_TASKS Rover tabs, new tabs default to observer-only.
   */
  canCreateNewTask(totalRoverTabCount: number): { allowed: boolean; reason?: string } {
    if (totalRoverTabCount > MAX_TABS_FOR_NEW_TASKS) {
      return {
        allowed: false,
        reason: `Too many Rover tabs open (${totalRoverTabCount}). Close some tabs to create new tasks.`,
      };
    }
    const activeCount = this.workerPool.getActiveCount();
    const queuedCount = this.workerPool.getQueuedTasks().length;
    if (activeCount >= 2 && queuedCount >= 3) {
      return {
        allowed: false,
        reason: 'Maximum parallel tasks reached. Complete or cancel a task first.',
      };
    }
    return { allowed: true };
  }

  /** Shutdown — terminate all workers and clean up. */
  shutdown(): void {
    this.workerPool.shutdown();
    this.tasks.clear();
    this.taskOrder = [];
    this.tabToTask.clear();
    this.activeTaskId = undefined;
  }
}
