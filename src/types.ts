/**
 * Time unit types for scheduling intervals
 */
export type TimeType = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

/**
 * Days of the week (lowercase for consistency)
 */
export type Day =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/**
 * How the day-of-month constraint is interpreted.
 *
 * - `"specific"` — `day` is a fixed day number (1–31).
 * - `"last"` — recompute each cycle as the last day of the current month
 *   (so `endOf("month")` is correct in February vs. March).
 */
export type DayOfMonthMode = "specific" | "last";

/**
 * Job interval configuration
 */
export type JobIntervals = {
  /** Day of week (string) or day of month (1–31) */
  day?: Day | number;
  /**
   * Day-of-month interpretation. Defaults to `"specific"` when `day` is a
   * number. `"last"` overrides `day` and resolves to `daysInMonth()` per cycle.
   */
  dayOfMonthMode?: DayOfMonthMode;
  /** Month constraint (1–12). Used by `beginOf`/`endOf` of `"year"`. */
  month?: number;
  /** Time of day in HH:mm or HH:mm:ss format */
  time?: string;
  /** Recurring interval configuration */
  every?: {
    type?: TimeType;
    value?: number;
  };
};

/**
 * Result of a job execution
 */
export type JobResult = {
  /** Whether the job completed successfully */
  success: boolean;
  /** Execution duration in milliseconds */
  duration: number;
  /** Error if the job failed */
  error?: unknown;
  /** Number of retry attempts made */
  retries?: number;
};

/**
 * Job execution status
 */
export type JobStatus = "idle" | "running" | "completed" | "failed";

/**
 * Retry configuration for jobs
 */
export type RetryConfig = {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  delay: number;
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier?: number;
};

/**
 * Scheduler event types for observability
 */
export type SchedulerEvents = {
  "job:start": [jobName: string];
  "job:complete": [jobName: string, result: JobResult];
  "job:error": [jobName: string, error: unknown];
  "job:skip": [jobName: string, reason: string];
  "scheduler:started": [];
  "scheduler:stopped": [];
  "scheduler:tick": [timestamp: Date];
};
