/**
 * WorkerPool — bounded concurrent Web Worker management.
 *
 * Manages 2-3 concurrent workers (configurable via maxWorkers).
 * Tasks beyond the limit are queued. Max 5 queued tasks.
 */

export type WorkerConfig = {
  workerUrl: string;
  /** Passed to Worker constructor */
  workerOptions?: WorkerOptions;
};

export type WorkerPoolOptions = {
  /** Maximum concurrent workers. Default: 2, max: 3 */
  maxWorkers?: number;
  /** Maximum queued tasks. Default: 5 */
  maxQueue?: number;
  /** Called when a worker slot is freed and a task is dequeued */
  onWorkerFreed?: (dequeuedTaskId: string) => void;
};

const DEFAULT_MAX_WORKERS = 2;
const MAX_ALLOWED_WORKERS = 3;
const DEFAULT_MAX_QUEUE = 5;

export class WorkerPool {
  private maxWorkers: number;
  private maxQueue: number;
  private activeWorkers: Map<string, Worker> = new Map(); // taskId → Worker
  private queue: string[] = []; // taskIds waiting for a worker
  public onWorkerFreed?: (dequeuedTaskId: string) => void;

  constructor(options?: WorkerPoolOptions) {
    this.maxWorkers = Math.min(
      Math.max(1, Number(options?.maxWorkers) || DEFAULT_MAX_WORKERS),
      MAX_ALLOWED_WORKERS,
    );
    this.maxQueue = Math.max(1, Number(options?.maxQueue) || DEFAULT_MAX_QUEUE);
    this.onWorkerFreed = options?.onWorkerFreed;
  }

  /**
   * Acquire a worker slot for a task.
   * Returns a new Worker if a slot is available, null if queued.
   */
  acquire(taskId: string, config: WorkerConfig): Worker | null {
    // Already has a worker
    if (this.activeWorkers.has(taskId)) {
      return this.activeWorkers.get(taskId)!;
    }

    // Remove from queue if present
    this.removeFromQueue(taskId);

    if (this.activeWorkers.size < this.maxWorkers) {
      const worker = new Worker(config.workerUrl, config.workerOptions);
      this.activeWorkers.set(taskId, worker);
      return worker;
    }

    // At capacity → queue
    if (this.queue.length >= this.maxQueue) {
      // Auto-cancel oldest queued task to make room
      this.queue.shift();
    }
    this.queue.push(taskId);
    return null;
  }

  /**
   * Release a worker slot for a task.
   * Terminates the worker and triggers dequeue if tasks are waiting.
   */
  release(taskId: string): void {
    const worker = this.activeWorkers.get(taskId);
    if (worker) {
      try {
        worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.activeWorkers.delete(taskId);
    }

    // Remove from queue if present
    this.removeFromQueue(taskId);

    // Dequeue next waiting task
    this.dequeueNext();
  }

  /** Get the worker for a specific task (if active). */
  getWorker(taskId: string): Worker | undefined {
    return this.activeWorkers.get(taskId);
  }

  /** Number of currently active workers. */
  getActiveCount(): number {
    return this.activeWorkers.size;
  }

  /** Check if a task is queued (waiting for a worker). */
  isQueued(taskId: string): boolean {
    return this.queue.includes(taskId);
  }

  /** Get all queued task IDs. */
  getQueuedTasks(): string[] {
    return [...this.queue];
  }

  /** Get all active task IDs. */
  getActiveTasks(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /** Terminate all workers and clear the queue. */
  shutdown(): void {
    for (const [, worker] of this.activeWorkers) {
      try {
        worker.terminate();
      } catch {
        // Ignore
      }
    }
    this.activeWorkers.clear();
    this.queue = [];
  }

  private removeFromQueue(taskId: string): void {
    const idx = this.queue.indexOf(taskId);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  private dequeueNext(): void {
    if (this.queue.length === 0) return;
    if (this.activeWorkers.size >= this.maxWorkers) return;

    const nextTaskId = this.queue.shift();
    if (nextTaskId && this.onWorkerFreed) {
      this.onWorkerFreed(nextTaskId);
    }
  }
}
