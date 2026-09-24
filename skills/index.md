---
description: "In-process job scheduler for Warlock.js with fluent and cron scheduling, retries, overlap prevention and timezones. Exports `Scheduler`, `scheduler`, `Job`, `job`, `CronParser`, `parseCron`, plus types `RetryConfig`, `JobResult`, `SchedulerEvents`. Use for: \"run this every day at 3am\", \"run a cron expression on weekdays\", \"retry a failing job 3 times\", \"stop a job overlapping itself\", \"run in New York time\", \"log job failures\". Not this package: durable queues and background workers are not scheduling; per-run locking across instances uses @warlock.js/cache."
---
# @warlock.js/scheduler

Build a `job(name, fn)`, describe when it runs with the fluent API (`.daily().at("03:00")`) or `.cron("...")`, add it to a `Scheduler`, then `start()`. Events (`job:error` and others) provide observability; `shutdown()` stops gracefully.

## The 80% path
1. Orient: `overview.md`, `scheduler-basics.md`.
2. Define the schedule fluently: `schedule-fluently.md`, or by cron: `schedule-with-cron.md`.
3. Make it resilient: `configure-retry-and-overlap.md`.
4. Fix wall-clock semantics: `pin-schedule-timezone.md`.
5. Watch it run: `observe-scheduler.md`.

## Conventions and pitfalls
- It is in-memory and per-process: each app instance runs its own copy. With multiple instances, guard jobs with a lock (for example `@warlock.js/cache`) or run the scheduler in one instance only.
- Missed runs while the process was down are not replayed.
- Set a timezone explicitly for jobs tied to business hours; otherwise the host's applies.
- Call `scheduler.shutdown()` on SIGTERM so running jobs finish.
- Use `preventOverlap()` for jobs that can outlast their interval.
