import type { PersistedTaskState } from './runtimeTypes.js';

export type TaskKernelLifecycleState = 'idle' | 'running' | 'awaiting_user' | 'terminal';

export type TaskKernelCommand =
  | {
      type: 'ensure_running';
      reason?: string;
      at?: number;
    }
  | {
      type: 'awaiting_user';
      reason?: string;
      at?: number;
    }
  | {
      type: 'terminal';
      terminal: 'completed' | 'failed' | 'cancelled' | 'ended';
      reason?: string;
      at?: number;
    }
  | {
      type: 'new_task';
      reason?: string;
      at?: number;
      taskId?: string;
    };

export type TaskKernelInput = {
  task?: PersistedTaskState;
  taskEpoch?: number;
};

export type TaskKernelResult = {
  task: PersistedTaskState;
  taskEpoch: number;
  lifecycle: TaskKernelLifecycleState;
  rotateBoundary: boolean;
  clearPendingRun: boolean;
  clearWorkerState: boolean;
};

type TaskKernelOptions = {
  createTask: (reason: string, at: number, taskId?: string) => PersistedTaskState;
};

function toStatus(terminal: 'completed' | 'failed' | 'cancelled' | 'ended'): PersistedTaskState['status'] {
  return terminal;
}

function normalizeEpoch(input: number | undefined): number {
  return Math.max(1, Number(input) || 1);
}

function lifecycleFromTask(task: PersistedTaskState | undefined): TaskKernelLifecycleState {
  if (!task) return 'idle';
  if (task.status !== 'running') return 'terminal';
  const boundaryReason = String(task.boundaryReason || '').trim().toLowerCase();
  if (boundaryReason.includes('waiting_for_input') || boundaryReason.includes('awaiting_user')) {
    return 'awaiting_user';
  }
  return 'running';
}

export function isTerminalTaskStatus(status?: PersistedTaskState['status']): boolean {
  return (
    status === 'completed'
    || status === 'cancelled'
    || status === 'failed'
    || status === 'ended'
  );
}

export function reduceTaskKernel(
  input: TaskKernelInput,
  command: TaskKernelCommand,
  options: TaskKernelOptions,
): TaskKernelResult {
  const now = Number(command.at) || Date.now();
  const reason = String(command.reason || 'kernel').trim() || 'kernel';
  const epoch = normalizeEpoch(input.taskEpoch);
  const baseTask = input.task || options.createTask(reason, now, (command as any).taskId);

  if (command.type === 'new_task') {
    const nextTask = options.createTask(reason, now, command.taskId);
    return {
      task: nextTask,
      taskEpoch: epoch + 1,
      lifecycle: 'running',
      rotateBoundary: true,
      clearPendingRun: true,
      clearWorkerState: true,
    };
  }

  if (command.type === 'terminal') {
    const status = toStatus(command.terminal);
    const nextTask: PersistedTaskState = {
      ...baseTask,
      status,
      boundaryReason: reason,
      endedAt: now,
    };
    return {
      task: nextTask,
      taskEpoch: epoch,
      lifecycle: 'terminal',
      rotateBoundary: false,
      clearPendingRun: true,
      clearWorkerState: false,
    };
  }

  const runningReason = reason;
  const nextTask: PersistedTaskState = {
    ...baseTask,
    status: 'running',
    boundaryReason: runningReason,
    endedAt: undefined,
  };
  if (!nextTask.lastUserAt && !nextTask.lastAssistantAt) {
    nextTask.lastAssistantAt = now;
  }

  return {
    task: nextTask,
    taskEpoch: epoch,
    lifecycle: command.type === 'awaiting_user' ? 'awaiting_user' : lifecycleFromTask(nextTask),
    rotateBoundary: false,
    clearPendingRun: false,
    clearWorkerState: false,
  };
}
