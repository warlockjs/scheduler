import dayjs, { type Dayjs } from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { CronParser } from "./cron-parser";
import type { Day, JobIntervals, JobResult, RetryConfig, TimeType } from "./types";

// Enable timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

export type JobCallback = (job: Job) => Promise<any>;

/**
 * Days of week mapping (lowercase for consistency with Day type)
 */
const DAYS_OF_WEEK: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Job class represents a scheduled task with configurable timing and execution options.
 *
 * @example
 * ```typescript
 * const job = new Job("cleanup", async () => {
 *   await cleanupOldFiles();
 * })
 *   .everyDay()
 *   .at("03:00")
 *   .inTimezone("America/New_York")
 *   .preventOverlap()
 *   .retry(3, 1000);
 * ```
 */
export class Job {
  // ─────────────────────────────────────────────────────────────────────────────
  // Private Properties
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Interval configuration for scheduling
   */
  private _intervals: JobIntervals = {};

  /**
   * Last execution timestamp
   */
  private _lastRun: Dayjs | null = null;

  /**
   * Whether the job is currently executing
   */
  private _isRunning = false;

  /**
   * Skip execution if job is already running
   */
  private _skipIfRunning = false;

  /**
   * Retry configuration
   */
  private _retryConfig: RetryConfig | null = null;

  /**
   * Timezone for scheduling (defaults to system timezone)
   */
  private _timezone = "UTC";

  /**
   * Cron expression parser (mutually exclusive with interval config)
   */
  private _cronParser: CronParser | null = null;

  /**
   * Promise resolver for completion waiting
   */
  private _completionResolver: (() => void) | null = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Properties
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Next scheduled execution time
   */
  public nextRun: Dayjs | null = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new Job instance
   *
   * @param name - Unique identifier for the job
   * @param callback - Function to execute when the job runs
   */
  public constructor(
    public readonly name: string,
    private readonly _callback: JobCallback,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Getters
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if the job is currently executing
   */
  public get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Returns the last execution timestamp
   */
  public get lastRun(): Dayjs | null {
    return this._lastRun;
  }

  /**
   * Returns the current interval configuration (readonly)
   */
  public get intervals(): Readonly<JobIntervals> {
    return this._intervals;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Interval Configuration Methods (Fluent API)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set a custom interval for job execution
   *
   * @param value - Number of time units
   * @param timeType - Type of time unit
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.every(5, "minute"); // Run every 5 minutes
   * job.every(2, "hour");   // Run every 2 hours
   * ```
   */
  public every(value: number, timeType: TimeType): this {
    this._intervals.every = { type: timeType, value };
    this._determineNextRun();
    return this;
  }

  /**
   * Run job every second (use with caution - high frequency)
   */
  public everySecond(): this {
    return this.every(1, "second");
  }

  /**
   * Run job every specified number of seconds
   */
  public everySeconds(seconds: number): this {
    return this.every(seconds, "second");
  }

  /**
   * Run job every minute
   */
  public everyMinute(): this {
    return this.every(1, "minute");
  }

  /**
   * Run job every specified number of minutes
   */
  public everyMinutes(minutes: number): this {
    return this.every(minutes, "minute");
  }

  /**
   * Run job every hour
   */
  public everyHour(): this {
    return this.every(1, "hour");
  }

  /**
   * Run job every specified number of hours
   */
  public everyHours(hours: number): this {
    return this.every(hours, "hour");
  }

  /**
   * Run job every day at midnight
   */
  public everyDay(): this {
    return this.every(1, "day");
  }

  /**
   * Alias for everyDay()
   */
  public daily(): this {
    return this.everyDay();
  }

  /**
   * Run job twice a day (every 12 hours)
   */
  public twiceDaily(): this {
    return this.every(12, "hour");
  }

  /**
   * Run job every week
   */
  public everyWeek(): this {
    return this.every(1, "week");
  }

  /**
   * Alias for everyWeek()
   */
  public weekly(): this {
    return this.everyWeek();
  }

  /**
   * Run job every month
   */
  public everyMonth(): this {
    return this.every(1, "month");
  }

  /**
   * Alias for everyMonth()
   */
  public monthly(): this {
    return this.everyMonth();
  }

  /**
   * Run job every year
   */
  public everyYear(): this {
    return this.every(1, "year");
  }

  /**
   * Alias for everyYear()
   */
  public yearly(): this {
    return this.everyYear();
  }

  /**
   * Alias for everyMinute() - job runs continuously every minute
   */
  public always(): this {
    return this.everyMinute();
  }

  /**
   * Schedule job using a cron expression
   *
   * Supports standard 5-field cron syntax:
   * ```
   * ┌───────────── minute (0-59)
   * │ ┌───────────── hour (0-23)
   * │ │ ┌───────────── day of month (1-31)
   * │ │ │ ┌───────────── month (1-12)
   * │ │ │ │ ┌───────────── day of week (0-6, Sunday = 0)
   * │ │ │ │ │
   * * * * * *
   * ```
   *
   * Supports:
   * - '*' - any value
   * - '5' - specific value
   * - '1,3,5' - list of values
   * - '1-5' - range of values
   * - 'x/5' - step values (every 5)
   * - '1-10/2' - range with step
   *
   * @param expression - Standard 5-field cron expression
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.cron("0 9 * * 1-5");   // 9 AM weekdays
   * job.cron("x/5 * * * *");   // Every 5 minutes
   * job.cron("0 0 1 * *");     // First day of month at midnight
   * job.cron("0 x/2 * * *");   // Every 2 hours
   * ```
   */
  public cron(expression: string): this {
    this._cronParser = new CronParser(expression);
    // Clear interval config since cron takes precedence
    this._intervals = {};
    this._determineNextRun();
    return this;
  }

  /**
   * Get the cron expression if one is set
   */
  public get cronExpression(): string | null {
    return this._cronParser?.expression ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Day & Time Configuration Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Schedule job on a specific day
   *
   * @param day - Day of week (string) or day of month (number 1-31)
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.on("monday");  // Run on Mondays
   * job.on(15);        // Run on the 15th of each month
   * ```
   */
  public on(day: Day | number): this {
    if (typeof day === "number" && (day < 1 || day > 31)) {
      throw new Error("Invalid day of the month. Must be between 1 and 31.");
    }

    this._intervals.day = day;
    this._determineNextRun();
    return this;
  }

  /**
   * Schedule job at a specific time
   *
   * @param time - Time in HH:mm or HH:mm:ss format
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.daily().at("09:00");    // Run daily at 9 AM
   * job.weekly().at("14:30");   // Run weekly at 2:30 PM
   * ```
   */
  public at(time: string): this {
    // Validate time format
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
      throw new Error("Invalid time format. Use HH:mm or HH:mm:ss.");
    }

    this._intervals.time = time;
    this._determineNextRun();
    return this;
  }

  /**
   * Run task at the beginning of the specified time period
   *
   * @param type - Time type (day, month, year)
   */
  public beginOf(type: TimeType): this {
    const time = "00:00";

    switch (type) {
      case "day":
        break;
      case "month":
        this.on(1);
        break;
      case "year":
        this.on(1);
        this.every(1, "year");
        break;
      default:
        throw new Error(`Unsupported type for beginOf: ${type}`);
    }

    return this.at(time);
  }

  /**
   * Run task at the end of the specified time period
   *
   * @param type - Time type (day, month, year)
   */
  public endOf(type: TimeType): this {
    const now = this._now();
    const time = "23:59";

    switch (type) {
      case "day":
        break;
      case "month":
        this.on(now.endOf("month").date());
        break;
      case "year":
        this.on(31);
        this.every(1, "year");
        break;
      default:
        throw new Error(`Unsupported type for endOf: ${type}`);
    }

    return this.at(time);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Timezone Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set the timezone for this job's scheduling
   *
   * @param tz - IANA timezone string (e.g., "America/New_York", "Europe/London")
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.daily().at("09:00").inTimezone("America/New_York");
   * ```
   */
  public inTimezone(tz: string): this {
    this._timezone = tz;
    this._determineNextRun();
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Execution Options
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Prevent overlapping executions of this job
   *
   * When enabled, if the job is already running when it's scheduled to run again,
   * the new execution will be skipped.
   *
   * @param skip - Whether to skip if already running (default: true)
   * @returns this for chaining
   */
  public preventOverlap(skip = true): this {
    this._skipIfRunning = skip;
    return this;
  }

  /**
   * Configure automatic retry on failure
   *
   * @param maxRetries - Maximum number of retry attempts
   * @param delay - Delay between retries in milliseconds
   * @param backoffMultiplier - Optional multiplier for exponential backoff
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.retry(3, 1000);           // Retry 3 times with 1s delay
   * job.retry(5, 1000, 2);        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
   * ```
   */
  public retry(maxRetries: number, delay = 1000, backoffMultiplier?: number): this {
    this._retryConfig = {
      maxRetries,
      delay,
      backoffMultiplier,
    };
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Execution Control
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Terminate the job and clear all scheduling data
   */
  public terminate(): this {
    this._intervals = {};
    this.nextRun = null;
    this._lastRun = null;
    this._isRunning = false;
    return this;
  }

  /**
   * Prepare the job by calculating the next run time
   * Called by the scheduler when starting
   */
  public prepare(): void {
    this._determineNextRun();
  }

  /**
   * Determine if the job should run now
   *
   * @returns true if the job should execute
   */
  public shouldRun(): boolean {
    // Skip if already running and overlap prevention is enabled
    if (this._skipIfRunning && this._isRunning) {
      return false;
    }

    return this.nextRun !== null && this._now().isAfter(this.nextRun);
  }

  /**
   * Execute the job
   *
   * @returns Promise resolving to the job result
   */
  public async run(): Promise<JobResult> {
    const startTime = Date.now();
    let retries = 0;

    this._isRunning = true;

    try {
      const result = await this._executeWithRetry();
      this._lastRun = this._now();
      this._determineNextRun();

      return {
        success: true,
        duration: Date.now() - startTime,
        retries: result.retries || 0,
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error,
        retries: this._retryConfig?.maxRetries ?? 0,
      };
    } finally {
      this._isRunning = false;

      // Resolve any waiting completion promises
      if (this._completionResolver) {
        this._completionResolver();
        this._completionResolver = null;
      }
    }
  }

  /**
   * Wait for the job to complete
   * Useful for graceful shutdown
   *
   * @returns Promise that resolves when the job completes
   */
  public waitForCompletion(): Promise<void> {
    if (!this._isRunning) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this._completionResolver = resolve;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get current time, respecting timezone if set
   */
  private _now(): Dayjs {
    return this._timezone ? dayjs().tz(this._timezone) : dayjs();
  }

  /**
   * Execute the callback with retry logic
   */
  private async _executeWithRetry(): Promise<{ retries: number }> {
    let lastError: unknown;
    let attempts = 0;
    const maxAttempts = (this._retryConfig?.maxRetries ?? 0) + 1;

    while (attempts < maxAttempts) {
      try {
        await this._callback(this);
        return { retries: attempts };
      } catch (error) {
        lastError = error;
        attempts++;

        if (attempts < maxAttempts && this._retryConfig) {
          const delay = this._calculateRetryDelay(attempts);
          await this._sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Calculate retry delay with optional exponential backoff
   */
  private _calculateRetryDelay(attempt: number): number {
    if (!this._retryConfig) return 0;

    const { delay, backoffMultiplier } = this._retryConfig;

    if (backoffMultiplier) {
      return delay * Math.pow(backoffMultiplier, attempt - 1);
    }

    return delay;
  }

  /**
   * Sleep for specified milliseconds
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate the next run time based on interval or cron configuration
   */
  private _determineNextRun(): void {
    // If using cron expression, delegate to cron parser
    if (this._cronParser) {
      const now = this._now();
      this.nextRun = this._cronParser.nextRun(now);
      return;
    }

    // Otherwise use interval-based scheduling
    let date = this._lastRun ? this._lastRun.add(1, "second") : this._now();

    // Apply interval
    if (this._intervals.every?.value && this._intervals.every?.type) {
      date = date.add(this._intervals.every.value, this._intervals.every.type);
    }

    // Apply day constraint
    if (this._intervals.day !== undefined) {
      if (typeof this._intervals.day === "number") {
        date = date.date(this._intervals.day);
      } else {
        const targetDay = DAYS_OF_WEEK.indexOf(this._intervals.day);
        if (targetDay !== -1) {
          date = date.day(targetDay);
        }
      }
    }

    // Apply time constraint
    if (this._intervals.time) {
      const parts = this._intervals.time.split(":").map(Number);
      const [hour, minute, second = 0] = parts;
      date = date.hour(hour).minute(minute).second(second).millisecond(0);
    }

    // Ensure the next run is in the future
    while (date.isBefore(this._now())) {
      if (this._intervals.every?.value && this._intervals.every?.type) {
        date = date.add(this._intervals.every.value, this._intervals.every.type);
      } else {
        // Default to adding one day if there's no specific interval defined
        date = date.add(1, "day");
      }
    }

    this.nextRun = date;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factory function to create a new Job instance
 *
 * @param name - Unique identifier for the job
 * @param callback - Function to execute when the job runs
 * @returns New Job instance
 *
 * @example
 * ```typescript
 * const cleanupJob = job("cleanup", async () => {
 *   await db.deleteExpiredTokens();
 * }).daily().at("03:00");
 * ```
 */
export function job(name: string, callback: JobCallback): Job {
  return new Job(name, callback);
}
