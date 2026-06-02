import dayjs, { type Dayjs } from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { CronParser } from "./cron-parser";
import type { Day, JobIntervals, JobResult, RetryConfig, TimeType } from "./types";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrAfter);

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
 * Validate a `HH:mm` or `HH:mm:ss` string and return its parts.
 * Throws when the format is malformed or any part is out of range.
 */
function parseTimeString(time: string): {
  hour: number;
  minute: number;
  second: number;
} {
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
    throw new Error("Invalid time format. Use HH:mm or HH:mm:ss.");
  }

  const [hour, minute, second = 0] = time.split(":").map(Number);

  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour in time "${time}". Must be between 0 and 23.`);
  }

  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute in time "${time}". Must be between 0 and 59.`);
  }

  if (second < 0 || second > 59) {
    throw new Error(`Invalid second in time "${time}". Must be between 0 and 59.`);
  }

  return { hour, minute, second };
}

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
   * Last execution timestamp.
   *
   * Updated after every run attempt — successful or failed — so the next-run
   * calculation always advances even when a job throws. Use the `job:complete`
   * / `job:error` events if you need to distinguish success from failure.
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
   * Timezone for scheduling (defaults to UTC)
   */
  private _timezone = "UTC";

  /**
   * Cron expression parser (mutually exclusive with interval config)
   */
  private _cronParser: CronParser | null = null;

  /**
   * All pending `waitForCompletion()` resolvers — drained on every run end.
   */
  private _completionResolvers: (() => void)[] = [];

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
   * Returns the last execution timestamp (success OR failure).
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
   * @param value - Number of time units (must be > 0)
   * @param timeType - Type of time unit
   * @returns this for chaining
   * @throws Error if `value` is not a positive finite number
   *
   * @example
   * ```typescript
   * job.every(5, "minute"); // Run every 5 minutes
   * job.every(2, "hour");   // Run every 2 hours
   * ```
   */
  public every(value: number, timeType: TimeType): this {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid interval value: ${value}. Must be a positive finite number.`,
      );
    }

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
   * - '*‍/5' - step values (every 5)
   * - '1-10/2' - range with step
   *
   * @param expression - Standard 5-field cron expression
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.cron("0 9 * * 1-5");   // 9 AM weekdays
   * job.cron("*‍/5 * * * *");   // Every 5 minutes
   * job.cron("0 0 1 * *");     // First day of month at midnight
   * job.cron("0 *‍/2 * * *");   // Every 2 hours
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

    if (typeof day === "number") {
      this._intervals.dayOfMonthMode = "specific";
    }

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
    parseTimeString(time);
    this._intervals.time = time;
    this._determineNextRun();

    return this;
  }

  /**
   * Run task at the beginning of the specified time period.
   *
   * - `"day"`   → 00:00 every day
   * - `"month"` → 1st of every month at 00:00
   * - `"year"`  → January 1st at 00:00 every year
   *
   * @param type - Time type (day, month, year)
   */
  public beginOf(type: TimeType): this {
    switch (type) {
      case "day":
        this._intervals.every = { type: "day", value: 1 };
        break;

      case "month":
        this._intervals.day = 1;
        this._intervals.dayOfMonthMode = "specific";
        this._intervals.every = { type: "month", value: 1 };
        break;

      case "year":
        this._intervals.month = 1;
        this._intervals.day = 1;
        this._intervals.dayOfMonthMode = "specific";
        this._intervals.every = { type: "year", value: 1 };
        break;

      default:
        throw new Error(`Unsupported type for beginOf: ${type}`);
    }

    return this.at("00:00");
  }

  /**
   * Run task at the end of the specified time period.
   *
   * - `"day"`   → 23:59 every day
   * - `"month"` → last day of every month at 23:59 (recomputed each cycle —
   *   correct in February vs. March)
   * - `"year"`  → December 31st at 23:59 every year
   *
   * @param type - Time type (day, month, year)
   */
  public endOf(type: TimeType): this {
    switch (type) {
      case "day":
        this._intervals.every = { type: "day", value: 1 };
        break;

      case "month":
        this._intervals.dayOfMonthMode = "last";
        this._intervals.every = { type: "month", value: 1 };
        break;

      case "year":
        this._intervals.month = 12;
        this._intervals.day = 31;
        this._intervals.dayOfMonthMode = "specific";
        this._intervals.every = { type: "year", value: 1 };
        break;

      default:
        throw new Error(`Unsupported type for endOf: ${type}`);
    }

    return this.at("23:59");
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
   * Prevent overlapping executions of this job.
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
   * @param maxRetries - Maximum number of retry attempts (must be ≥ 0)
   * @param delay - Delay between retries in milliseconds (must be ≥ 0)
   * @param backoffMultiplier - Optional multiplier for exponential backoff (must be > 0)
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * job.retry(3, 1000);           // Retry 3 times with 1s delay
   * job.retry(5, 1000, 2);        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
   * ```
   */
  public retry(maxRetries: number, delay = 1000, backoffMultiplier?: number): this {
    if (!Number.isFinite(maxRetries) || maxRetries < 0) {
      throw new Error(`Invalid maxRetries: ${maxRetries}. Must be ≥ 0.`);
    }

    if (!Number.isFinite(delay) || delay < 0) {
      throw new Error(`Invalid retry delay: ${delay}. Must be ≥ 0.`);
    }

    if (
      backoffMultiplier !== undefined &&
      (!Number.isFinite(backoffMultiplier) || backoffMultiplier <= 0)
    ) {
      throw new Error(
        `Invalid backoffMultiplier: ${backoffMultiplier}. Must be > 0.`,
      );
    }

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
    this._cronParser = null;
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
   * Returns true if the job's `nextRun` has arrived, regardless of whether
   * it is currently running. Used by the scheduler to decide whether a
   * tick is "due" before checking overlap state.
   */
  public isDue(): boolean {
    return this.nextRun !== null && this._now().isSameOrAfter(this.nextRun);
  }

  /**
   * Determine if the job should run now.
   *
   * Combines `isDue()` with the overlap-prevention rule: when
   * `preventOverlap()` is on and the job is already running, this returns
   * false even if the next-run time has arrived.
   *
   * @returns true if the job should execute
   */
  public shouldRun(): boolean {
    if (this._skipIfRunning && this._isRunning) {
      return false;
    }

    return this.isDue();
  }

  /**
   * Execute the job once.
   *
   * Always advances `lastRun` and recalculates `nextRun` (success OR failure)
   * so a permanently failing job does not re-fire on every scheduler tick.
   *
   * @returns Promise resolving to the job result
   */
  public async run(): Promise<JobResult> {
    const startTime = Date.now();

    this._isRunning = true;

    let result: JobResult;
    let executedRetries = 0;

    try {
      const inner = await this._executeWithRetry();
      executedRetries = inner.retries;

      result = {
        success: true,
        duration: Date.now() - startTime,
        retries: executedRetries,
      };
    } catch (error) {
      result = {
        success: false,
        duration: Date.now() - startTime,
        error,
        retries: this._retryConfig?.maxRetries ?? 0,
      };
    } finally {
      this._lastRun = this._now();
      this._determineNextRun();
      this._isRunning = false;

      // Drain ALL pending waiters (waitForCompletion may be called more than once).
      const resolvers = this._completionResolvers.splice(0);

      for (const resolve of resolvers) {
        resolve();
      }
    }

    return result;
  }

  /**
   * Wait for the currently executing run to complete.
   *
   * Multiple concurrent waiters are all resolved when the run finishes.
   * Useful for graceful shutdown.
   *
   * @returns Promise that resolves when the job completes
   */
  public waitForCompletion(): Promise<void> {
    if (!this._isRunning) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this._completionResolvers.push(resolve);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get current time, respecting the configured timezone.
   */
  private _now(): Dayjs {
    return dayjs().tz(this._timezone);
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Apply month / day-of-month / day-of-week / time constraints to a Dayjs.
   *
   * Re-applied after every interval advance inside `_determineNextRun` so
   * dynamic constraints (`dayOfMonthMode: "last"` recomputed per month, month
   * lock for `beginOf/endOf("year")`) stay correct as the candidate moves
   * forward.
   */
  private _applyConstraints(date: Dayjs): Dayjs {
    let result = date;

    if (this._intervals.month !== undefined) {
      result = result.month(this._intervals.month - 1);
    }

    if (this._intervals.dayOfMonthMode === "last") {
      result = result.date(result.daysInMonth());
    } else if (this._intervals.day !== undefined) {
      if (typeof this._intervals.day === "number") {
        result = result.date(this._intervals.day);
      } else {
        const targetDay = DAYS_OF_WEEK.indexOf(this._intervals.day);

        if (targetDay !== -1) {
          result = result.day(targetDay);
        }
      }
    }

    if (this._intervals.time) {
      const { hour, minute, second } = parseTimeString(this._intervals.time);
      result = result.hour(hour).minute(minute).second(second).millisecond(0);
    }

    return result;
  }

  /**
   * Calculate the next run time based on interval or cron configuration.
   *
   * Strategy: apply all constraints (month, day, time) ONCE before the
   * advance loop, then advance by `every` until the candidate is in the
   * future. Static constraints (numeric day, fixed month, fixed time)
   * survive `dayjs.add()` automatically. The only dynamic constraint —
   * `dayOfMonthMode: "last"` — is re-applied inside the loop so the
   * candidate always lands on the *new* month's last day after each
   * advance.
   *
   * Re-applying time/day inside the loop would deadlock: with
   * `twiceDaily().at("06:00")` we'd advance 06:00 → 18:00 → snap back to
   * 06:00 → 18:00 → ... forever.
   */
  private _determineNextRun(): void {
    if (this._cronParser) {
      const now = this._now();
      this.nextRun = this._cronParser.nextRun(now);
      return;
    }

    const intervalValue = this._intervals.every?.value;
    const intervalType = this._intervals.every?.type;
    const hasInterval = !!(intervalValue && intervalType);

    // After a previous run, jump ahead by EXACTLY one interval. Previously
    // we used `lastRun + 1s` and relied on the advance loop to catch up,
    // but that loop only triggers when the candidate is in the past — so
    // for fast-completing callbacks the candidate stayed at `lastRun + 1s`,
    // making `everySeconds(2)` fire every second. Honor the interval up
    // front instead.
    let date: Dayjs;

    if (this._lastRun && hasInterval) {
      date = this._lastRun.add(intervalValue!, intervalType);
    } else if (this._lastRun) {
      date = this._lastRun.add(1, "second");
    } else {
      date = this._now();
    }

    date = this._applyConstraints(date);

    while (date.isBefore(this._now())) {
      if (hasInterval) {
        date = date.add(intervalValue!, intervalType);
      } else {
        date = date.add(1, "day");
      }

      if (this._intervals.dayOfMonthMode === "last") {
        date = date.date(date.daysInMonth());
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
