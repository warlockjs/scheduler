---
name: configure-retry-and-overlap
description: 'Configure `.retry(maxRetries, delay?, backoffMultiplier?)` for fixed / exponential backoff and `.preventOverlap()` for external-invocation safety. Triggers: `.retry`, `.preventOverlap`, `maxRetries`, `backoffMultiplier`, `JobResult.retries`, `job:error`, `job:skip`; "how do I retry a failed job", "exponential backoff for scheduled job", "prevent concurrent job runs", "stop firing after N consecutive failures"; typical import `import { job, scheduler } from "@warlock.js/scheduler"`. Skip: events / shutdown — `@warlock.js/scheduler/observe-scheduler/SKILL.md`; building the schedule itself — `@warlock.js/scheduler/schedule-fluently/SKILL.md`; competing libs `p-retry`, `async-retry`, `bullmq`.'
---

# Retry, backoff, and overlap

Two independent execution-control concerns on a single `Job`. They compose cleanly.

## `.retry(maxRetries, delay?, backoffMultiplier?)`

```ts
job("send-report", sendReport)
  .daily()
  .at("08:00")
  .retry(3);                  // 3 retries, 1000ms apart (default delay)

job("sync", syncInventory)
  .everyHour()
  .retry(5, 2000);             // 5 retries, 2000ms each

job("queue", processQueue)
  .everyMinutes(10)
  .retry(5, 1000, 2);          // exponential: 1s → 2s → 4s → 8s → 16s
```

**Signature:** `retry(maxRetries: number, delay = 1000, backoffMultiplier?: number): this`

**Formula:** delay before attempt `N+1` = `delay × backoffMultiplier^(N-1)`. Without a multiplier, all retries wait `delay` ms.

**Validation.** Throws at definition time on negative `maxRetries`, negative `delay`, or zero/negative `backoffMultiplier`. `retry(0)` is valid — means "no retries, single attempt."

## Retry count surfaces in `JobResult`

```ts
scheduler.on("job:complete", (name, result) => {
  if (result.retries && result.retries > 0) {
    log.warn({ name, retries: result.retries }, "succeeded after retries");
  }
});

scheduler.on("job:error", (name, error) => {
  // Fires once, AFTER all retries are exhausted.
  log.error({ name, error }, "failed permanently");
});
```

`JobResult.retries`:
- On **success**: the number of failed attempts before the eventual success (0 if first attempt succeeded).
- On **failure**: equals the configured `maxRetries` (all of them were used).

## After permanent failure — `nextRun` advances normally

This is load-bearing: a job that exhausts every retry and still throws does **not** re-fire on the next tick. The scheduler:

1. Emits `job:error` once with the final error.
2. Advances `nextRun` by the job's interval, same as success.

Both branches go through the same `finally`-block path in `Job.run()`. There is no "stuck on retry" mode.

```ts
// Fires every 10 minutes, retries 3 times per fire.
// If the 10:00 run exhausts all retries, next run is at 10:10. NOT at 10:00:00.001.
job("flaky", fn).everyMinutes(10).retry(3, 1000);
```

To **stop** firing after N consecutive failures, do it in user code:

```ts
let consecutiveFailures = 0;
scheduler.on("job:error", name => {
  if (name !== "flaky") return;
  consecutiveFailures++;
  if (consecutiveFailures >= 5) {
    scheduler.removeJob("flaky");
    alert.critical("flaky disabled after 5 failures");
  }
});
scheduler.on("job:complete", name => {
  if (name === "flaky") consecutiveFailures = 0;
});
```

## `.preventOverlap(skip = true)`

Tells the scheduler to skip a tick if the job is already running.

```ts
job("queue", processQueue)
  .everyMinutes(5)
  .preventOverlap();
```

**Important nuance.** The scheduler awaits each tick's jobs before scheduling the next tick — so **concurrent same-job runs from the scheduler's own loop are structurally impossible**, regardless of `preventOverlap()`. Where it actually matters: jobs whose callbacks ALSO get invoked outside the scheduler.

Real-world shapes that benefit:

```ts
// 1) Boot-time recovery sweep before normal scheduling.
const queueJob = job("queue", processQueueOnce).everyMinutes(5).preventOverlap();
scheduler.addJob(queueJob);
queueJob.run().catch(err => log.error({ err }, "boot sweep failed"));
scheduler.start();

// 2) Admin-triggered manual re-run from a dashboard endpoint.
app.post("/admin/jobs/:name/run", async (req, res) => {
  const j = scheduler.getJob(req.params.name);
  await j?.run();
  res.sendStatus(204);
});

// 3) Multiple scheduler instances pointed at the same Job (rare).
```

If a tick lands while one of these external runs is mid-flight:
- Scheduler emits `job:skip` with reason `"Job is already running"`
- The tick proceeds without re-entering the job

For a single-process app where the callback is only ever invoked via the scheduler, `preventOverlap()` is a no-op — but it's free, defensive documentation. Keep it on for any job that touches shared state.

## Combining retry + preventOverlap

They compose cleanly. Retry happens WITHIN one fire — if all retries fail, the tick ends and `nextRun` advances. `preventOverlap` matters only between fires.

```ts
job("long-flaky", processQueue)
  .everyMinutes(5)
  .preventOverlap()
  .retry(3, 1000, 2);   // up to 1 + 2 + 4 = 7 s of retry delay per fire
```

If retries push the total work past the next interval, `preventOverlap()` ensures the next scheduled tick skips instead of stacking.

## See also

- [`@warlock.js/scheduler/observe-scheduler/SKILL.md`](@warlock.js/scheduler/observe-scheduler/SKILL.md) — full event reference, `JobResult` shape, lifecycle
- [`@warlock.js/scheduler/schedule-fluently/SKILL.md`](@warlock.js/scheduler/schedule-fluently/SKILL.md) — the scheduling methods these compose with
