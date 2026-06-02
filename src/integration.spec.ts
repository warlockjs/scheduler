import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { job } from "./job";
import { Scheduler } from "./scheduler";
import type { JobResult } from "./types";

beforeAll(() => {
  dayjs.extend(utc);
  dayjs.extend(timezone);
});

const NOW = new Date("2026-05-11T10:00:00Z"); // Mon 10:00 UTC

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// 1. Full production setup — multi-job, observability listeners, lifecycle.
//    Mirrors the "Complete Setup" example in domains/scheduler/docs/configuration.mdx.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — production-style multi-job setup", () => {
  it("fires every job at its own cadence and emits all lifecycle events", async () => {
    // Set NOW to 02:59 so the daily-at-03:00 job fires within one tick.
    vi.setSystemTime(new Date("2026-05-11T02:59:00Z"));

    const scheduler = new Scheduler();

    const lifecycleEvents: string[] = [];
    const jobStarts: string[] = [];
    const jobCompletes: { name: string; result: JobResult }[] = [];
    const jobErrors: { name: string; error: unknown }[] = [];

    scheduler.on("scheduler:started", () => lifecycleEvents.push("started"));
    scheduler.on("scheduler:stopped", () => lifecycleEvents.push("stopped"));
    scheduler.on("job:start", name => jobStarts.push(name));
    scheduler.on("job:complete", (name, result) =>
      jobCompletes.push({ name, result }),
    );
    scheduler.on("job:error", (name, error) =>
      jobErrors.push({ name, error }),
    );

    const cleanupCallback = vi.fn().mockResolvedValue(undefined);
    const reportCallback = vi.fn().mockResolvedValue(undefined);
    const heartbeatCallback = vi.fn().mockResolvedValue(undefined);

    scheduler.runEvery(60_000); // 1-minute ticks
    scheduler.addJobs([
      job("token-cleanup", cleanupCallback)
        .daily()
        .at("03:00")
        .preventOverlap()
        .retry(3, 0),
      job("hourly-report", reportCallback).daily().at("03:30"),
      job("heartbeat", heartbeatCallback).everyMinutes(15),
    ]);

    scheduler.start();

    // Advance 35 minutes — covers cleanup (03:00), report (03:30),
    // and multiple heartbeat firings.
    await vi.advanceTimersByTimeAsync(35 * 60_000);

    expect(cleanupCallback).toHaveBeenCalledTimes(1);
    expect(reportCallback).toHaveBeenCalledTimes(1);
    expect(heartbeatCallback.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Every job:start has a matching job:complete (no errors in this scenario).
    expect(jobCompletes.length).toBe(jobStarts.length);
    expect(jobErrors).toHaveLength(0);

    // All completions report success.
    for (const { result } of jobCompletes) {
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
    }

    scheduler.stop();
    expect(lifecycleEvents).toEqual(["started", "stopped"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Flaky external API recovers via exponential backoff.
//    Mirrors the "process-queue" example in retry-backoff.mdx.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — flaky API recovers via backoff", () => {
  it("retries with backoff, emits a single job:complete with retries=2, no job:error", async () => {
    const scheduler = new Scheduler();

    let attempts = 0;
    const callback = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("transient network error");
      }
    });

    scheduler.addJob(
      job("api-sync", callback).everyHour().retry(3, 100, 2),
    );

    const startEvents: string[] = [];
    const completeEvents: JobResult[] = [];
    const errorEvents: unknown[] = [];
    scheduler.on("job:start", () => startEvents.push("start"));
    scheduler.on("job:complete", (_, result) => completeEvents.push(result));
    scheduler.on("job:error", (_, error) => errorEvents.push(error));

    scheduler.start();

    // First tick at t=1000 → callback fails, sleep 100ms → fails, sleep 200ms → succeeds.
    // Total retry time: 100 + 200 = 300ms. Allow generous margin.
    await vi.advanceTimersByTimeAsync(2_000);

    expect(callback).toHaveBeenCalledTimes(3);
    expect(startEvents).toHaveLength(1);
    expect(completeEvents).toHaveLength(1);
    expect(errorEvents).toHaveLength(0);
    expect(completeEvents[0].success).toBe(true);
    expect(completeEvents[0].retries).toBe(2);

    // nextRun must advance by the JOB interval (1 hour), not by retry timing.
    const jobInstance = scheduler.getJob("api-sync")!;
    const lastRun = jobInstance.lastRun!;
    const nextRun = jobInstance.nextRun!;
    expect(nextRun.diff(lastRun, "minute")).toBeGreaterThanOrEqual(59);

    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Long-running queue processor with overlap prevention.
//    The scheduler awaits its own ticks, so overlap in this single-process
//    design occurs when a run was kicked off outside the scheduler loop —
//    e.g. a startup-recovery flow that pre-empts the first tick.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — overlap prevention blocks concurrent runs", () => {
  it("skips ticks while an externally-initiated run is in flight", async () => {
    const scheduler = new Scheduler();
    const jobInstance = job("queue-processor", async () => {
      await sleep(3_000);
    })
      .everySecond()
      .preventOverlap();

    scheduler.addJob(jobInstance);

    // Kick the job off before the scheduler starts (mirrors a boot-time
    // recovery sweep before normal scheduling begins).
    const externalRun = jobInstance.run();
    await vi.advanceTimersByTimeAsync(1);
    expect(jobInstance.isRunning).toBe(true);

    const skipEvents: { name: string; reason: string }[] = [];
    scheduler.on("job:skip", (name, reason) =>
      skipEvents.push({ name, reason }),
    );

    scheduler.start();
    // Three ticks should see the job still running and skip each one.
    await vi.advanceTimersByTimeAsync(2_500);

    expect(skipEvents.length).toBeGreaterThanOrEqual(2);
    for (const skip of skipEvents) {
      expect(skip).toEqual({
        name: "queue-processor",
        reason: "Job is already running",
      });
    }

    // Stop the scheduler before the external run finishes so it does not
    // immediately re-fire the job on the next tick.
    scheduler.stop();

    // Let the external run drain.
    await vi.advanceTimersByTimeAsync(3_000);
    await externalRun;
    expect(jobInstance.isRunning).toBe(false);

    await vi.runAllTimersAsync();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-region daily digest — same logical job, three timezones.
//    Mirrors the "morning report" example in timezone.mdx.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — multi-region daily digest", () => {
  it("each region fires exactly once per day at its local 09:00", async () => {
    vi.setSystemTime(new Date("2026-05-11T00:00:00Z"));

    const scheduler = new Scheduler();
    const fires = new Map<string, number>();

    scheduler.on("job:start", name => {
      fires.set(name, (fires.get(name) ?? 0) + 1);
    });

    // 1-hour tick interval keeps the 24-hour simulation cheap (24 ticks).
    scheduler.runEvery(60 * 60 * 1000);

    scheduler.addJobs([
      job("digest-utc", async () => {})
        .daily()
        .at("09:00")
        .inTimezone("UTC"),
      job("digest-algiers", async () => {})
        .daily()
        .at("09:00")
        .inTimezone("Africa/Algiers"), // UTC+1, no DST
      job("digest-berlin", async () => {})
        .daily()
        .at("09:00")
        .inTimezone("Europe/Berlin"), // CEST in May = UTC+2
    ]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(fires.get("digest-utc")).toBe(1);
    expect(fires.get("digest-algiers")).toBe(1);
    expect(fires.get("digest-berlin")).toBe(1);

    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Graceful SIGTERM-style shutdown — in-flight jobs finish, restart works.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — graceful shutdown", () => {
  it("waits for in-flight jobs, emits scheduler:stopped, and can be restarted", async () => {
    const scheduler = new Scheduler();
    let jobAFinished = false;
    let jobBFinished = false;

    scheduler.runInParallel(true);
    scheduler.addJobs([
      job("a", async () => {
        await sleep(500);
        jobAFinished = true;
      }).everySecond(),
      job("b", async () => {
        await sleep(500);
        jobBFinished = true;
      }).everySecond(),
    ]);

    const stoppedListener = vi.fn();
    scheduler.on("scheduler:stopped", stoppedListener);

    scheduler.start();
    // Fire the first tick — both jobs start (parallel mode), each sleeps 500ms.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(scheduler.list()[0].isRunning).toBe(true);
    expect(scheduler.list()[1].isRunning).toBe(true);

    const shutdownPromise = scheduler.shutdown();
    await vi.advanceTimersByTimeAsync(500); // let both jobs finish
    await shutdownPromise;

    expect(jobAFinished).toBe(true);
    expect(jobBFinished).toBe(true);
    expect(stoppedListener).toHaveBeenCalledOnce();
    expect(scheduler.isRunning).toBe(false);

    // Restart should succeed cleanly.
    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
    await vi.runAllTimersAsync();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Permanently failing job — regression for P0 #1 (tightloop on failure).
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — permanently failing job", () => {
  it("respects the interval after every failed run (no tickloop)", async () => {
    const scheduler = new Scheduler();

    const callback = vi.fn(async () => {
      throw new Error("always fails");
    });
    scheduler.addJob(
      job("doomed", callback).every(2, "second").retry(0),
    );

    const errorEvents: unknown[] = [];
    scheduler.on("job:error", (_, error) => errorEvents.push(error));

    scheduler.start();
    await vi.advanceTimersByTimeAsync(7_000);

    // every 2s for 7 s with first tick at 1 s: fires at ~1, ~3, ~5, ~7 → 4 times.
    // Without the +interval fix, nextRun would advance by 1 s and the job
    // would fire on EVERY tick (~7 times). Use a tight upper bound to catch
    // any regression of the bug.
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(callback.mock.calls.length).toBeLessThanOrEqual(5);
    expect(errorEvents.length).toBe(callback.mock.calls.length);

    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Dynamic registration during operation.
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration — dynamic registration during operation", () => {
  it("addJobs/removeJob mid-run honors immediately on the next tick", async () => {
    const scheduler = new Scheduler();

    const originalCb = vi.fn().mockResolvedValue(undefined);
    const lateCb1 = vi.fn().mockResolvedValue(undefined);
    const lateCb2 = vi.fn().mockResolvedValue(undefined);

    scheduler.addJob(job("original", originalCb).everySecond());
    scheduler.start();

    // Let the original fire once.
    await vi.advanceTimersByTimeAsync(1_500);
    const originalCallsBeforeRemove = originalCb.mock.calls.length;
    expect(originalCallsBeforeRemove).toBeGreaterThanOrEqual(1);

    // Add two new jobs and remove the original — all while running.
    scheduler.addJobs([
      job("late-1", lateCb1).everySecond(),
      job("late-2", lateCb2).everySecond(),
    ]);
    scheduler.removeJob("original");

    expect(scheduler.jobCount).toBe(2);

    // Advance enough for several more ticks.
    await vi.advanceTimersByTimeAsync(3_500);

    expect(lateCb1.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(lateCb2.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Original must NOT have fired after removal.
    expect(originalCb.mock.calls.length).toBe(originalCallsBeforeRemove);

    scheduler.stop();
  });
});
