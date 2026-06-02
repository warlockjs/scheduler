---
name: overview
description: 'Front-door orientation for `@warlock.js/scheduler` — cron-like job scheduling with fluent schedule API (`.daily().at()`, `.weekly().on()`, `.cron("...")`), retry with backoff, overlap prevention, IANA timezone pinning, and seven typed lifecycle events. UTC default; opt into local time per job. TRIGGER when: code imports anything from `@warlock.js/scheduler`; user asks "what does @warlock.js/scheduler do", "compare with node-cron / agenda / bull", "schedule a cron job in Node", "how do I prevent overlapping runs", "how do I retry a failed job", "what timezone does the scheduler use"; package.json adds `@warlock.js/scheduler`. Skip: specific task already known — load the matching task skill directly (`scheduler-basics`, `schedule-fluently`, `schedule-with-cron`, `configure-retry-and-overlap`, `pin-schedule-timezone`, `observe-scheduler`); ad-hoc `setTimeout` / `setInterval` for one-off delays (no cron / retry / observability needed).'
---

# `@warlock.js/scheduler` — overview

Production-ready job scheduler with a cron engine, fluent schedule builder, retry-with-backoff, overlap prevention, IANA timezone pinning, and seven typed lifecycle events. Two primitives — `job(name, fn)` and the `scheduler` singleton — that compose into everything else.

## When to reach for it

- You have **recurring work** in a Node service (cleanups, reports, syncs, polling) and want it scheduled inside the app process — no external cron, no docker-cron sidecar.
- You'd reach for **node-cron** or **agenda** but want a typed fluent API, retry-with-backoff, overlap prevention, and a working observability story built in — without bringing Redis (agenda) or hand-rolling retry yourself (node-cron).
- You're inside a `@warlock.js/*` project — the framework already uses this for built-in maintenance jobs (token cleanup, etc.).

Skip if you need a **distributed** job queue with persistence, retries across processes, and worker pools — reach for **BullMQ** or **Temporal**. This package runs jobs **in-process**; if the process dies before the next tick, the schedule resumes from now, not from the missed fire time.

## The mental model in one paragraph

Define a job with `job("name", async () => { ... })`. Attach a schedule via the fluent API (`.daily().at("03:00")`) or a cron string (`.cron("0 3 * * *")`). Optionally pin a timezone (`.inTimezone("America/New_York")`), prevent concurrent runs (`.preventOverlap()`), and configure retries (`.retry(3, 1000)`). Register the job with `scheduler.addJob(job)`, call `scheduler.start()`, and listen on the seven lifecycle events (`job:start` / `complete` / `error` / `skip`, `scheduler:started` / `stopped` / `tick`) for logging, metrics, and alerting. `scheduler.shutdown()` drains in-flight jobs before exit.

## Skills index

Six task skills cover the full surface. Most callers only need `scheduler-basics` + `schedule-fluently` + `observe-scheduler`.

### Foundations

#### [`scheduler-basics`](@warlock.js/scheduler/scheduler-basics/SKILL.md)
Start here. The `job(name, fn)` factory, the `scheduler` singleton, the 2-primitive surface, UTC default, why the API is factory-first.

### Scheduling

#### [`schedule-fluently`](@warlock.js/scheduler/schedule-fluently/SKILL.md)
Build schedules without writing cron: `.everyMinutes(N)`, `.daily().at("03:00")`, `.weekly().on("monday")`, `.monthly()`, `.beginOf("month")`, `.endOf("year")`, and friends. Reach for this 80% of the time.

#### [`schedule-with-cron`](@warlock.js/scheduler/schedule-with-cron/SKILL.md)
Drop down to `.cron("0 9 * * 1-5")` when the fluent API can't express it (Vixie OR semantics for DOM/DOW, complex multi-value lists). Includes `parseCron()` for previewing next-run times before deploy.

### Production concerns

#### [`configure-retry-and-overlap`](@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md)
`.retry(maxRetries, delay?, backoffMultiplier?)` for fixed or exponential backoff; `.preventOverlap()` so a slow run never collides with the next tick. Reach for both anytime a job calls external services.

#### [`pin-schedule-timezone`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md)
`.inTimezone("America/New_York")` pins wall-clock fire times across DST and across servers. The default is UTC — if your job description includes "9 AM," you almost certainly want this skill.

### Observability + shutdown

#### [`observe-scheduler`](@warlock.js/scheduler/observe-scheduler/SKILL.md)
The seven typed `SchedulerEvents` (`job:start` / `complete` / `error` / `skip`, `scheduler:started` / `stopped` / `tick`), the `JobResult` payload, `start()` / `stop()` / `shutdown()`. Wire this for logging, metrics, alerting, and graceful SIGTERM handling.

## Quick taste

```ts
import { Scheduler, job } from "@warlock.js/scheduler";

const scheduler = new Scheduler();

scheduler.on("job:error", (name, error) => {
  console.error(`${name} failed:`, error);
});

scheduler.addJob(
  job("cleanup", async () => {
    await cleanupExpiredTokens();
  })
    .daily()
    .at("03:00")
    .inTimezone("America/New_York")
    .preventOverlap()
    .retry(3, 1000),
);

scheduler.addJob(
  job("reports", sendReports).cron("0 9 * * 1-5"), // 9 AM weekdays
);

scheduler.start();
process.on("SIGTERM", () => scheduler.shutdown());
```

## What this package deliberately doesn't do

- **Distributed scheduling across processes.** Jobs run in the calling process. For multi-instance deployments, either run the scheduler on one instance (with a leader election) or reach for BullMQ / Temporal.
- **Persistent job state across restarts.** A missed fire while the process was down is missed — it doesn't catch up. For exactly-once-eventually semantics, use a queue.
- **Job priority queues or fan-out.** One job = one function. For fan-out, your job dispatches to a queue.
- **Cron-syntax extensions** beyond the standard 5-field form (no `@daily` macros, no seconds field). Use the fluent API for human-readable schedules instead.

## See also

- [`@warlock.js/core/overview/SKILL.md`](@warlock.js/core/overview/SKILL.md) — the parent framework that scheduled jobs typically run alongside.
- `mongez-agent-kit-authoring-skills` (load via agent-kit sync) — how this `overview/SKILL.md` becomes the front-door skill in `.claude/skills/warlock-js-scheduler-overview/`. Every cross-link above uses the `@warlock.js/scheduler/<skill>/SKILL.md` name form so it survives that flattening.
