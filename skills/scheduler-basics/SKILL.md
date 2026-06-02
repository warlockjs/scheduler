---
name: scheduler-basics
description: 'Start with `@warlock.js/scheduler` — `job()` factory + `scheduler` singleton, 2-primitive surface, UTC default, factory-first API. Triggers: `job`, `scheduler`, `scheduler.addJob`, `scheduler.start`, `scheduler.newJob`; "schedule a recurring job", "how to use warlock scheduler", "where do I start"; typical import `import { job, scheduler } from "@warlock.js/scheduler"`. Skip: fluent — `@warlock.js/scheduler/schedule-fluently/SKILL.md`; cron — `@warlock.js/scheduler/schedule-with-cron/SKILL.md`; retry — `@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`; events — `@warlock.js/scheduler/observe-scheduler/SKILL.md`; timezone — `@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`; competing `bullmq`, `agenda`, `node-cron`; native `setInterval`.'
---

# Schedule recurring jobs

In-process recurring job scheduler. Built on `dayjs`. Two primitives, factory-first API, type-safe events.

> This skill is the scheduler **map** — read it first, then load the specific skill for the task.

## The 2-primitive surface

```
Job          → the scheduled unit          (factory: `job(name, callback)`)
Scheduler    → the runtime / tick loop     (singleton: `scheduler` | class: `new Scheduler()`)
```

A `Job` carries the schedule (interval or cron), retry config, overlap rule, timezone, and the callback. A `Scheduler` owns the tick loop, the registered jobs, the parallel/sequential execution mode, and emits lifecycle events. The exported `CronParser` is a utility for ad-hoc cron preview — not part of the scheduling flow.

## Install

```bash
yarn add @warlock.js/scheduler
```

## Foundations

The 9 things that are true in every scheduler use:

1. **Factory-first.** `import { job, scheduler } from "@warlock.js/scheduler"`. Users do not call `new Job()` directly (it works, but `job()` is the documented surface).
2. **Default timezone is UTC.** `daily().at("09:00")` fires at 09:00 UTC, regardless of the server's clock. Pin a job to wall-clock with `.inTimezone("America/New_York")`. See [`@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md).
3. **The scheduler awaits each tick.** Concurrent same-job runs from the scheduler's own loop are structurally impossible. `preventOverlap()` is for jobs that ALSO get invoked outside the loop. See [`@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`](@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md).
4. **Cron uses 5-field Vixie semantics.** When both `dayOfMonth` and `dayOfWeek` are restricted (neither is `*`), a date matches if EITHER constraint matches. Standard-cron compatible. See [`@warlock.js/scheduler/schedule-with-cron/SKILL.md`](@warlock.js/scheduler/schedule-with-cron/SKILL.md).
5. **`nextRun` always advances after a run — success OR failure.** A permanently failing job re-fires on its next scheduled slot, not on every tick.
6. **Validation throws at definition time.** `every(0)`, `at("24:00")`, `on(32)`, `retry(-1)`, malformed cron — all throw immediately when you wire the job, not at runtime.
7. **`Job.run()` returns a `JobResult`, never throws.** Errors funnel into `result.error`. The scheduler emits `job:error` after all retries are exhausted.
8. **Parallel mode is within a tick, not across.** Even with `runInParallel(true)`, the NEXT tick waits for the current tick's jobs to all settle.
9. **Tick interval is drift-compensated.** A tick that takes 200 ms is followed by an 800 ms delay so the cadence between tick *starts* averages `tickInterval`, not `tickInterval + work-time`.

## 30-second example

```ts
import { scheduler, job } from "@warlock.js/scheduler";

scheduler.on("job:error", (name, error) => logger.error({ name, error }));

scheduler.addJob(
  job("nightly-cleanup", async () => {
    await db.deleteExpiredTokens();
  })
    .daily()
    .at("03:00")
    .inTimezone("America/New_York")
    .preventOverlap()
    .retry(3, 1000)
);

scheduler.start();

process.on("SIGTERM", async () => {
  await scheduler.shutdown(30_000);
  process.exit(0);
});
```

## Pick a skill

| If the task is about… | Load |
| --- | --- |
| Building schedules via `every*`/`daily`/`weekly`/`monthly`/`at`/`on`/`beginOf`/`endOf` | [`@warlock.js/scheduler/schedule-fluently/SKILL.md`](@warlock.js/scheduler/schedule-fluently/SKILL.md) |
| Writing `.cron("…")` expressions, debugging DOM/DOW behavior, using `parseCron()` for preview | [`@warlock.js/scheduler/schedule-with-cron/SKILL.md`](@warlock.js/scheduler/schedule-with-cron/SKILL.md) |
| Configuring `.retry()` / exponential backoff, `.preventOverlap()`, understanding failure rescheduling | [`@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`](@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md) |
| Subscribing to scheduler events, reading `JobResult`, lifecycle, graceful shutdown | [`@warlock.js/scheduler/observe-scheduler/SKILL.md`](@warlock.js/scheduler/observe-scheduler/SKILL.md) |
| Per-job `.inTimezone()`, multi-region patterns, DST handling | [`@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md) |

## When NOT to use this skill

- Jobs imported from `bullmq`, `agenda`, `node-cron`, etc. — those are different libraries.
- Long-running queue workers (consumer processes) — this is a scheduler, not a queue.
- One-off "run this at a specific date once" — currently not supported (on the backlog as `runAt()`).
- Multi-replica deployments needing leader election — also on the backlog (distributed locking).

## Package structure

```
@warlock.js/scheduler
  src/
    index.ts        — barrel: Scheduler, scheduler, Job, job, CronParser, parseCron, types
    scheduler.ts    — Scheduler class + default singleton
    job.ts          — Job class + job() factory
    cron-parser.ts  — CronParser class + parseCron() factory
    types.ts        — TimeType, Day, JobIntervals, JobResult, RetryConfig, SchedulerEvents
```
