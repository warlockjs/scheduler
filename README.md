# @warlock.js/scheduler

In-process recurring job scheduler. Fluent and cron-style scheduling, typed events, per-job timezones, retry with optional exponential backoff, and graceful shutdown.

```bash
npm install @warlock.js/scheduler
```

## What it gives you

- **Fluent API** — `daily()`, `weekly()`, `monthly()`, `at()`, `on()`, `beginOf()`, `endOf()`, `every(N, unit)`
- **Cron expressions** — standard 5-field syntax, Vixie OR semantics for day-of-month + day-of-week
- **Retry** — fixed delay or exponential backoff, per-attempt count surfaced in `JobResult`
- **Overlap prevention** — skip a tick if the job is already running (defensive for jobs with external invocation paths)
- **Per-job timezone** — pin a job to an IANA timezone; DST handled automatically
- **Typed events** — `job:start` / `job:complete` / `job:error` / `job:skip` / `scheduler:tick` / `scheduler:started` / `scheduler:stopped`
- **Graceful shutdown** — wait for in-flight jobs with a configurable timeout
- **Drift-compensated ticks** — the cadence between tick *starts* stays close to the configured interval, not `interval + work-time`

## 30-line example

```ts
import { scheduler, job } from "@warlock.js/scheduler";

scheduler.on("job:complete", (name, result) => {
  console.log(`${name} finished in ${result.duration}ms`);
});

scheduler.on("job:error", (name, error) => {
  console.error(`${name} failed permanently`, error);
});

scheduler.addJob(
  job("nightly-cleanup", async () => {
    await db.deleteExpiredTokens();
  })
    .daily()
    .at("03:00")
    .inTimezone("America/New_York")
    .preventOverlap()
    .retry(3, 1000),
);

scheduler.addJob(
  job("heartbeat", pingExternalService).everyMinutes(5),
);

scheduler.start();

process.on("SIGTERM", async () => {
  await scheduler.shutdown(30_000);
  process.exit(0);
});
```

## Documentation

- **User docs** — [`domains/scheduler/docs/`](../../domains/scheduler/docs/) — concepts, recipes, full API reference
- **Backlog** — [`domains/scheduler/backlog.md`](../../domains/scheduler/backlog.md) — what's planned next (distributed locking, per-job timeout, `runAt`, jitter, cron shortcuts, …)
- **Assistant skill** — [`skills/SKILL.md`](./skills/SKILL.md) — loaded by Claude Code when it sees imports from this package
