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
 * Job interval configuration
 */
export type JobIntervals = {
  /** Day of week or day of month */
  day?: Day | number;
  /** Time of day in HH:mm format */
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
