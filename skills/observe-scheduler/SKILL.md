---
name: observe-scheduler
description: 'Subscribe to scheduler lifecycle and job events for logging / metrics / alerting / graceful shutdown — seven typed `SchedulerEvents`, `JobResult` payload, `start()` / `stop()` / `shutdown()`. Triggers: `scheduler.on`, `scheduler.shutdown`, `JobResult`, `job:complete`, `job:error`, `scheduler:started`, `scheduler.getJob`; "graceful SIGTERM shutdown", "did this job run", "scheduler metrics and alerts", "subscribe to job events"; typical import `import { scheduler, type JobResult } from "@warlock.js/scheduler"`. Skip: retry / overlap — `@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`; building schedules — `@warlock.js/scheduler/schedule-fluently/SKILL.md`; native `EventEmitter`, `process.on`.'
---

# Observability and lifecycle

The `Scheduler` extends Node's `EventEmitter` with a fully-typed surface. Wire listeners before calling `.start()`.

## All seven events

```ts
type SchedulerEvents = {
  "job:start":         [jobName: string];
  "job:complete":      [jobName: string, result: JobResult];
  "job:error":         [jobName: string, error: unknown];
  "job:skip":          [jobName: string, reason: string];
  "scheduler:started": [];
  "scheduler:stopped": [];
  "scheduler:tick":    [timestamp: Date];
};
```

| Event                | When it fires                                                                          |
| -------------------- | -------------------------------------------------------------------------------------- |
| `scheduler:started`  | Once, after `.start()` enters the tick loop                                            |
| `scheduler:stopped`  | When `.stop()` halts the loop. Not emitted if `.stop()` was a no-op (never started)    |
| `scheduler:tick`     | Every tick — once per `runEvery()` interval (default 1 s). Keep handlers lightweight.  |
| `job:start`          | Just before a job's callback is first invoked (NOT once per retry)                     |
| `job:complete`       | When a job finishes successfully (possibly after retries)                              |
| `job:error`          | When a job exhausts all retries and the final attempt still throws                     |
| `job:skip`           | When a tick finds the job already running (see retry-and-overlap for when this occurs) |

**Contract for retries.** `job:start` and `job:complete`/`job:error` fire **once per fire**, not once per retry attempt. The retry count surfaces inside the `JobResult` passed to `job:complete`, or as `result.retries === maxRetries` on the failure path.

## `JobResult` shape

```ts
type JobResult = {
  success: boolean;
  duration: number;    // milliseconds, end-to-end including retry waits
  error?: unknown;     // present when success === false
  retries?: number;    // attempts that failed before the final outcome
};
```

`duration` is wall-clock from the first attempt's start to the final settlement — useful for both p50 metrics and capacity planning.

## Subscribing

```ts
import type { JobResult } from "@warlock.js/scheduler";
import { scheduler } from "@warlock.js/scheduler";

scheduler.on("job:start",    name           => log.debug({ name }, "job start"));
scheduler.on("job:complete", (name, result: JobResult) => {
  log.info({ name, duration: result.duration, retries: result.retries }, "job complete");
});
scheduler.on("job:error",    (name, error)  => log.error({ name, error }, "job failed"));
scheduler.on("job:skip",     (name, reason) => log.warn({ name, reason }, "job skipped"));
```

`.on()`, `.once()`, `.off()` are all type-narrowed via `SchedulerEvents`.

## Lifecycle methods

### `.start()`

Prepares every registered job (computes initial `nextRun`) and enters the tick loop. Emits `scheduler:started`.

Throws if:
- already running (`"Scheduler is already running."`)
- zero jobs registered (`"Cannot start scheduler with no jobs."`)

### `.stop()`

Immediately clears the next-tick timer. Does NOT wait for jobs currently mid-execution. Emits `scheduler:stopped`. **No-op if not running** — calling `.stop()` on a never-started or already-stopped scheduler is safe and silent.

### `.shutdown(timeout = 30000)`

Graceful equivalent of `.stop()`:

1. Marks the scheduler as shutting down (no new ticks scheduled).
2. Calls `.stop()` internally (so `scheduler:stopped` fires).
3. Awaits every currently-running job's `waitForCompletion()`, capped by `timeout`.
4. Resolves either when all jobs finish or when the timeout elapses.

```ts
process.on("SIGTERM", async () => {
  await scheduler.shutdown(30_000);
  process.exit(0);
});
```

The timeout is a HARD cap — jobs still running after it are abandoned (their promises keep resolving in the background, but the scheduler doesn't await them). The package does not currently support per-job timeouts or `AbortSignal` cancellation.

## Production observer pattern

Wire all observers before `start()`, in one place:

```ts
import { scheduler } from "@warlock.js/scheduler";
import { logger } from "./logger";
import { metrics } from "./metrics";
import { alerts } from "./alerts";

scheduler.on("job:start", name => metrics.increment(`job.start.${name}`));

scheduler.on("job:complete", (name, result) => {
  metrics.increment(`job.success.${name}`);
  metrics.timing(`job.duration.${name}`, result.duration);
  if (result.retries) metrics.increment(`job.retries.${name}`, result.retries);
});

scheduler.on("job:error", (name, error) => {
  logger.error({ name, error }, "Job failed permanently");
  alerts.critical(`Scheduler job "${name}" failed`, error);
});

scheduler.on("job:skip", (name, reason) => {
  logger.warn({ name, reason }, "Job skipped — likely external invocation in flight");
});

scheduler.on("scheduler:started", () => logger.info("scheduler up"));
scheduler.on("scheduler:stopped", () => logger.info("scheduler down"));

// Register jobs, then:
scheduler.start();
```

## Inspection at runtime

```ts
scheduler.isRunning;             // boolean
scheduler.jobCount;              // number of registered jobs
scheduler.list();                // readonly Job[]
scheduler.getJob("name");        // Job | undefined
```

And on each `Job`:

```ts
job.nextRun;                     // Dayjs | null
job.lastRun;                     // Dayjs | null — success OR failure
job.isRunning;                   // boolean
job.intervals;                   // readonly schedule config
job.cronExpression;              // string | null
```

## See also

- [`@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`](@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md) — what triggers each event in detail
- [`@warlock.js/scheduler/schedule-fluently/SKILL.md`](@warlock.js/scheduler/schedule-fluently/SKILL.md) — the methods that mutate the state these getters expose
