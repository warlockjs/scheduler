import { EventEmitter } from "events";
import { Job, JobCallback } from "./job";
import type { JobResult, SchedulerEvents } from "./types";

/**
 * Type-safe event emitter interface for Scheduler events
 */
interface TypedEventEmitter<TEvents extends Record<string, unknown[]>> {
  on<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  once<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  off<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): boolean;
}

/**
 * Scheduler class manages and executes scheduled jobs.
 *
 * Features:
 * - Event-based observability
 * - Parallel or sequential job execution
 * - Drift compensation for accurate timing
 * - Graceful shutdown with job draining
 *
 * @example
 * ```typescript
 * const scheduler = new Scheduler();
 *
 * scheduler.on('job:error', (jobName, error) => {
 *   logger.error(`Job ${jobName} failed:`, error);
 * });
 *
 * scheduler
 *   .addJob(cleanupJob)
 *   .addJob(reportJob)
 *   .runInParallel(true)
 *   .start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => scheduler.shutdown());
 * ```
 */
export class Scheduler
  extends (EventEmitter as new () => TypedEventEmitter<SchedulerEvents>)
  implements TypedEventEmitter<SchedulerEvents>
{
  // ─────────────────────────────────────────────────────────────────────────────
  // Private Properties
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List of registered jobs
   */
  private _jobs: Job[] = [];

  /**
   * Reference to the current timeout for stopping
   */
  private _timeoutId: NodeJS.Timeout | null = null;

  /**
   * Tick interval in milliseconds (how often to check for due jobs)
   */
  private _tickInterval = 1000;

  /**
   * Whether to run due jobs in parallel
   */
  private _runInParallel = false;

  /**
   * Maximum concurrent jobs when running in parallel
   */
  private _maxConcurrency = 10;

  /**
   * Flag indicating scheduler is shutting down
   */
  private _isShuttingDown = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Getters
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if the scheduler is currently running
   */
  public get isRunning(): boolean {
    return this._timeoutId !== null;
  }

  /**
   * Returns the number of registered jobs
   */
  public get jobCount(): number {
    return this._jobs.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration Methods (Fluent API)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a job to the scheduler
   *
   * @param job - Job instance to schedule
   * @returns this for chaining
   */
  public addJob(job: Job): this {
    this._jobs.push(job);

    if (this.isRunning) {
      job.prepare();
    }

    return this;
  }

  /**
   * Alias to create a new job directly and store it
   */
  public newJob(name: string, jobCallback: JobCallback) {
    const job = new Job(name, jobCallback);
    this.addJob(job);
    return job;
  }

  /**
   * Add multiple jobs to the scheduler
   *
   * @param jobs - Array of Job instances
   * @returns this for chaining
   */
  public addJobs(jobs: Job[]): this {
    this._jobs.push(...jobs);
    return this;
  }

  /**
   * Remove a job from the scheduler by name
   *
   * @param jobName - Name of the job to remove
   * @returns true if job was found and removed
   */
  public removeJob(jobName: string): boolean {
    const index = this._jobs.findIndex((j) => j.name === jobName);
    if (index !== -1) {
      this._jobs.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get a job by name
   *
   * @param jobName - Name of the job to find
   * @returns Job instance or undefined
   */
  public getJob(jobName: string): Job | undefined {
    return this._jobs.find((j) => j.name === jobName);
  }

  /**
   * Get all registered jobs
   *
   * @returns Array of registered jobs (readonly)
   */
  public list(): readonly Job[] {
    return this._jobs;
  }

  /**
   * Set the tick interval (how often to check for due jobs)
   *
   * @param ms - Interval in milliseconds (minimum 100ms)
   * @returns this for chaining
   */
  public runEvery(ms: number): this {
    if (ms < 100) {
      throw new Error("Tick interval must be at least 100ms");
    }
    this._tickInterval = ms;
    return this;
  }

  /**
   * Configure whether jobs should run in parallel
   *
   * @param parallel - Enable parallel execution
   * @param maxConcurrency - Maximum concurrent jobs (default: 10)
   * @returns this for chaining
   */
  public runInParallel(parallel: boolean, maxConcurrency = 10): this {
    this._runInParallel = parallel;
    this._maxConcurrency = maxConcurrency;
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start the scheduler
   *
   * @throws Error if scheduler is already running
   */
  public start(): void {
    if (this.isRunning) {
      throw new Error("Scheduler is already running.");
    }

    if (this._jobs.length === 0) {
      throw new Error("Cannot start scheduler with no jobs.");
    }

    // Prepare all jobs (calculate initial next run times)
    for (const job of this._jobs) {
      job.prepare();
    }

    this._isShuttingDown = false;
    this._scheduleTick();

    this.emit("scheduler:started");
  }

  /**
   * Stop the scheduler immediately
   *
   * Note: This does not wait for running jobs to complete.
   * Use shutdown() for graceful termination.
   */
  public stop(): void {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    this.emit("scheduler:stopped");
  }

  /**
   * Gracefully shutdown the scheduler
   *
   * Stops scheduling new jobs and waits for currently running jobs to complete.
   *
   * @param timeout - Maximum time to wait for jobs (default: 30000ms)
   * @returns Promise that resolves when shutdown is complete
   */
  public async shutdown(timeout = 30000): Promise<void> {
    this._isShuttingDown = true;
    this.stop();

    // Get all currently running jobs
    const runningJobs = this._jobs.filter((j) => j.isRunning);

    if (runningJobs.length > 0) {
      // Wait for jobs to complete or timeout
      await Promise.race([
        Promise.all(runningJobs.map((j) => j.waitForCompletion())),
        new Promise<void>((resolve) => setTimeout(resolve, timeout)),
      ]);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Schedule the next tick
   */
  private _scheduleTick(): void {
    if (this._isShuttingDown) return;

    const startTime = Date.now();

    // Use setImmediate for first tick to allow event handlers to be registered
    this._timeoutId = setTimeout(async () => {
      await this._tick();

      // Calculate time spent and adjust next tick for drift compensation
      const elapsed = Date.now() - startTime;
      const nextTick = Math.max(this._tickInterval - elapsed, 0);

      this._scheduleTick();
    }, this._tickInterval);
  }

  /**
   * Execute a scheduler tick - check and run due jobs
   */
  private async _tick(): Promise<void> {
    this.emit("scheduler:tick", new Date());

    // Find jobs that should run
    const dueJobs = this._jobs.filter((job) => {
      if (!job.shouldRun()) return false;

      // Skip if overlap prevention is enabled and job is running
      if (job.isRunning) {
        this.emit("job:skip", job.name, "Job is already running");
        return false;
      }

      return true;
    });

    if (dueJobs.length === 0) return;

    if (this._runInParallel) {
      await this._runJobsInParallel(dueJobs);
    } else {
      await this._runJobsSequentially(dueJobs);
    }
  }

  /**
   * Run jobs sequentially
   */
  private async _runJobsSequentially(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      if (this._isShuttingDown) break;
      await this._runJob(job);
    }
  }

  /**
   * Run jobs in parallel with concurrency limit
   */
  private async _runJobsInParallel(jobs: Job[]): Promise<void> {
    // Simple batching for concurrency control
    const batches: Job[][] = [];

    for (let i = 0; i < jobs.length; i += this._maxConcurrency) {
      batches.push(jobs.slice(i, i + this._maxConcurrency));
    }

    for (const batch of batches) {
      if (this._isShuttingDown) break;
      await Promise.allSettled(batch.map((job) => this._runJob(job)));
    }
  }

  /**
   * Run a single job and emit events
   */
  private async _runJob(job: Job): Promise<JobResult> {
    this.emit("job:start", job.name);

    const result = await job.run();

    if (result.success) {
      this.emit("job:complete", job.name, result);
    } else {
      this.emit("job:error", job.name, result.error);
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default scheduler instance for simple use cases
 *
 * @example
 * ```typescript
 * import { scheduler, job } from "@warlock.js/scheduler";
 *
 * scheduler.addJob(job("cleanup", cleanupFn).daily());
 * scheduler.start();
 * ```
 */
export const scheduler = new Scheduler();
