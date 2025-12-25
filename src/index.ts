/**
 * @warlock.js/scheduler
 *
 * A production-ready job scheduler with cron-like functionality.
 *
 * @example
 * ```typescript
 * import { Scheduler, job } from "@warlock.js/scheduler";
 *
 * const scheduler = new Scheduler();
 *
 * // Add observability
 * scheduler.on('job:error', (name, error) => console.error(`${name} failed:`, error));
 *
 * // Schedule jobs with fluent API
 * scheduler.addJob(
 *   job("cleanup", async () => {
 *     await cleanupExpiredTokens();
 *   })
 *     .daily()
 *     .at("03:00")
 *     .inTimezone("America/New_York")
 *     .preventOverlap()
 *     .retry(3, 1000)
 * );
 *
 * // Or use cron expressions
 * scheduler.addJob(
 *   job("reports", sendReports).cron("0 9 * * 1-5")  // 9 AM weekdays
 * );
 *
 * // Start and handle graceful shutdown
 * scheduler.start();
 * process.on('SIGTERM', () => scheduler.shutdown());
 * ```
 *
 * @packageDocumentation
 */

// Core classes
export { CronParser, parseCron } from "./cron-parser";
export { Job, job } from "./job";
export { Scheduler, scheduler } from "./scheduler";

// Types
export type { CronFields } from "./cron-parser";

export type {
  Day,
  JobIntervals,
  JobResult,
  JobStatus,
  RetryConfig,
  SchedulerEvents,
  TimeType,
} from "./types";
