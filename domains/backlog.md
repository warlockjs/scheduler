# Scheduler — Backlog

**Status:** Active
**Last updated:** 2026-06-01

Roadmap of capabilities the package does not yet ship. Ranked by impact: top items are required before recommending the package for non-trivial production deployments; lower items are quality-of-life.

---

## Robustness & hygiene (found 2026-06-01 during docs/test hardening)

### A. `CronParser.nextRun()` stalls ~3.4 s on impossible-but-valid expressions

A 5-field expression can parse cleanly yet never match — e.g. `0 0 30 2 *` (Feb 30). `nextRun()` then scans forward `maxIterations = 366 * 24 * 60 = 527,040` passes before throwing `"Could not find next run time…"`. Measured ~3.4 s of synchronous CPU per call on a dev machine. If such an expression reaches a live tick (a cron job built from user/config input), it stalls the event loop for seconds before failing.

**Options.**
- Detect impossible day-of-month / month combinations at parse time and throw eagerly (cheapest, most user-friendly). `30 2`, `31 {2,4,6,9,11}`, `29 2` only valid in leap years.
- Or lower the scan bound to ~4 years of minutes and accept that genuinely-rare-but-real expressions still resolve.

A unit test for the throw branch was intentionally omitted from the suite because the single assertion adds ~3.4 s (the suite otherwise runs in <1 s). Add one once the scan is bounded faster.

### B. `JobStatus` type is exported but unused

`type JobStatus = "idle" | "running" | "completed" | "failed"` is re-exported from `index.ts` but nothing in the package produces or consumes it — `Job` exposes run state only through the `isRunning` boolean. Either wire a `status` getter on `Job` that returns a `JobStatus` (nicer for dashboards than juggling `isRunning` + last `JobResult`), or drop the dangling type before publishing so it does not imply a surface that doesn't exist.

### C. `parseWeekDayNumber` in `src/utils.ts` is dead code

`utils.ts` exports `parseWeekDayNumber(day: Day)` (capitalised-day lookup), but it is not re-exported from `index.ts` and is referenced nowhere in `src/`. `Job._applyConstraints` does its own lowercase `DAYS_OF_WEEK.indexOf(...)`. Delete `utils.ts` (and the file) or fold the helper into `job.ts` if a shared lookup is wanted — right now it is unreachable weight.

---

## P0 — Production blockers

### 1. Distributed locking / leader election

Multi-replica deployments (Kubernetes, Fargate, ECS, dyno-style hosts) currently run every job on every replica. There is no coordination layer, so a job scheduled `daily().at("03:00")` will fire N times if you scale to N replicas.

**Proposed shape.**

```ts
import { scheduler } from "@warlock.js/scheduler";
import { redisLock } from "@warlock.js/scheduler/locks/redis";

scheduler.lockProvider(redisLock({ client: redis }));

// Per-job opt-in:
job("nightly-cleanup", cleanupFn).daily().at("03:00").exclusive();
```

Defer the storage to a `LockProvider` contract (Redis, Postgres advisory lock, `@warlock.js/cache` driver). Default = no locking (single-replica behavior).

**Scope hint.** Keep the lock contract narrow — `acquire(key, ttl) → token | null`, `release(key, token) → void`, `extend(key, token, ttl) → void`. The job runner is responsible for extending mid-run if the job lasts longer than the TTL.

---

### 2. Per-job execution timeout

A hung job + `preventOverlap()` = the job never runs again because `_isRunning` stays `true` forever. Need a hard ceiling.

**Proposed shape.**

```ts
job("flaky-import", importFn)
  .everyHours(1)
  .timeout(5 * 60_000)   // abort after 5 minutes, mark as failed
  .preventOverlap();
```

When the timeout fires: race the callback against a timer; if the timer wins, mark the run failed (`error.code = "JOB_TIMEOUT"`), set `_isRunning = false`, advance `nextRun`. The job's promise should be allowed to keep running in the background (we cannot truly cancel arbitrary user code), but the scheduler treats it as finished. Document this clearly — users who need true cancellation must accept an `AbortSignal` parameter (separate feature).

---

### 3. Manual trigger — `runJobNow(name)`

Required for testing, admin panels, and "rerun this report manually" flows.

**Proposed shape.**

```ts
const result = await scheduler.runJobNow("nightly-cleanup");
// returns the JobResult; honors retry config; bypasses schedule but still
// fires job:start / job:complete events; respects preventOverlap if set.
```

---

## P1 — Strongly desired

### 4. One-off / `runAt(date)` jobs

Current API is recurring-only. There's no way to express "send this email at 9 AM tomorrow" without either using the scheduler tick to compare against `Date.now()` manually, or computing a custom interval.

**Proposed shape.**

```ts
job("welcome-email", sendWelcome).runAt(new Date("2026-05-12T09:00:00Z"));
// fires once at the given timestamp, then auto-removes itself from the scheduler
```

---

### 5. Pause / resume individual jobs

Removing + re-adding loses state and is awkward for admin UIs.

**Proposed shape.**

```ts
const job = scheduler.getJob("noisy-report");
job?.pause();   // skip until resumed; nextRun stays calculated
job?.resume();  // recompute nextRun and resume firing
```

---

### 6. Cron shortcuts (`@daily`, `@hourly`, `@every`, `@reboot`)

Standard cron compatibility — many teams expect these to "just work". Cheap to add as expression rewrites in `CronParser`.

```
@yearly   = 0 0 1 1 *
@monthly  = 0 0 1 * *
@weekly   = 0 0 * * 0
@daily    = 0 0 * * *
@hourly   = 0 * * * *
```

`@reboot` is a special case — fire once on `scheduler.start()`.

---

### 7. Named tokens in cron (`MON-FRI`, `JAN-DEC`, `7` for Sunday)

Standard cron compatibility. Implementation: rewrite tokens before `_parseField` dispatches.

---

### 8. Catch-up / missed-run policy

If the process is down across a scheduled time, current behavior silently skips. Should be opt-in:

```ts
job("daily-report", reportFn)
  .daily()
  .at("09:00")
  .runOnRecover();   // if start() happens after 09:00 today, fire immediately
```

Pairs with #9 (persistent `lastRun`).

---

### 9. Persistent `lastRun` across restarts

Without persisted state, `runOnRecover` from #8 cannot tell whether today's 09:00 run already happened in a previous process. Also useful for monitoring ("when did this last actually run?").

**Proposed shape.** Driver-based, same pattern as the lock provider (#1):

```ts
import { redisStore } from "@warlock.js/scheduler/stores/redis";
scheduler.stateStore(redisStore({ client: redis }));
```

Stores `{ jobName, lastRun, lastSuccess, lastError }` per job.

---

### 10. Jitter — `withJitter(maxMs)`

Prevents the thundering-herd problem when many jobs share `everyHour()` — they all fire at the top of the hour and slam the same downstream system.

```ts
job("send-digest", sendDigest)
  .everyHour()
  .withJitter(30_000);   // add 0-30 s random offset to nextRun
```

Implementation: after `_determineNextRun`, add `random(0, jitterMs)` to `nextRun`.

---

## P2 — Nice to have

### 11. 6-field cron with seconds

Match `node-cron` / Quartz precision. Detect 6 fields in `_parse` and treat the first as seconds.

### 12. Job groups / tags

```ts
job("a", fn).tags("reports", "weekly");
scheduler.pauseTag("reports");
scheduler.runTag("reports");
```

Useful for bulk pause/resume during deployments.

### 13. Built-in metrics adapter (OpenTelemetry / Prometheus)

Currently DIY via events. A small `@warlock.js/scheduler-otel` package could subscribe to events and emit canonical metrics: `scheduler_job_runs_total{status="success|error|skipped"}`, `scheduler_job_duration_seconds`, `scheduler_job_in_flight`.

### 14. Dead-letter / failure log

Where do permanently failed jobs go? Right now: the void + an event. A built-in in-memory ring buffer (`scheduler.failures(limit = 100)`) would help admin panels surface recent errors without forcing every consumer to wire up persistence.

### 15. AbortSignal support in callbacks

For graceful timeout (#2) and shutdown — pass a `signal` so well-behaved jobs can cancel I/O.

```ts
job("import", async (job, signal) => {
  await fetch(url, { signal });
});
```

---

## Won't ship (out of scope)

- **Job queues with workers / fan-out across processes.** That's a job queue (BullMQ, Sidekiq), not a scheduler. Composes with us, doesn't replace us.
- **GUI / web admin panel.** A separate package if anyone wants it; framework stays headless.
- **Cron `L` / `W` / `#` modifiers (Quartz-style).** Edge-case usage; revisit if asked. `endOf("month")` already covers the most common `L` use case.

---

## Recently fixed (moved out of backlog)

These issues were resolved on 2026-05-11 — see the related decisions log entry once written.

- ✅ Failed jobs re-fired on every tick (no `nextRun` advance on failure)
- ✅ `every(0, …)` infinite loop in `_determineNextRun`
- ✅ `beginOf("year")` / `endOf("year")` did not lock the month
- ✅ `endOf("month")` snapshotted the day at definition time (broke in months with different lengths)
- ✅ Drift compensation was dead code
- ✅ Cron `dayOfMonth` + `dayOfWeek` used AND semantics (Vixie cron is OR when both restricted)
- ✅ `addJobs()` did not prepare jobs added while running
- ✅ `_completionResolver` only stored one resolver (multiple `waitForCompletion` callers hung)
- ✅ `stop()` emitted `scheduler:stopped` even when never running
- ✅ `at()` did not validate hour/minute/second ranges
- ✅ `terminate()` did not clear the cron parser
- ✅ `shouldRun()` used strict `isAfter` (missing exact-tick edge)
