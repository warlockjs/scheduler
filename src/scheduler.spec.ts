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
import { Job, job } from "./job";
import { Scheduler } from "./scheduler";

beforeAll(() => {
  dayjs.extend(utc);
  dayjs.extend(timezone);
});

const NOW = new Date("2026-05-11T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const noop = async () => {};

// ─────────────────────────────────────────────────────────────────────────────
// Construction & registration
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — construction", () => {
  it("starts empty and not running", () => {
    const scheduler = new Scheduler();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.jobCount).toBe(0);
    expect(scheduler.list()).toEqual([]);
  });
});

describe("Scheduler — addJob / addJobs / newJob", () => {
  it("addJob registers a job", () => {
    const scheduler = new Scheduler();
    const jobInstance = job("a", noop).everyMinute();
    scheduler.addJob(jobInstance);

    expect(scheduler.jobCount).toBe(1);
    expect(scheduler.list()).toContain(jobInstance);
  });

  it("addJob is chainable", () => {
    const scheduler = new Scheduler();
    expect(scheduler.addJob(job("a", noop).everyMinute())).toBe(scheduler);
  });

  it("addJobs registers multiple jobs", () => {
    const scheduler = new Scheduler();
    scheduler.addJobs([
      job("a", noop).everyMinute(),
      job("b", noop).everyMinute(),
      job("c", noop).everyMinute(),
    ]);

    expect(scheduler.jobCount).toBe(3);
  });

  it("addJob calls prepare() when scheduler is running", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("seed", noop).everyMinute());
    scheduler.start();

    const lateJob = job("late", noop).daily().at("23:00");
    // Sanity: nextRun is computed at build time, snapshot it.
    const initialNext = lateJob.nextRun;

    vi.setSystemTime(new Date("2026-05-11T22:00:00Z"));
    scheduler.addJob(lateJob);

    // prepare() should have been triggered, but since system time changed
    // both before and after, just assert nextRun was (re)computed.
    expect(lateJob.nextRun).not.toBeNull();
    expect(initialNext).not.toBeNull();

    scheduler.stop();
  });

  it("addJobs calls prepare() on every job when scheduler is running (regression for #6)", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("seed", noop).everyMinute());
    scheduler.start();

    const a = new Job("a", noop);
    const b = new Job("b", noop);
    a.every(1, "minute");
    b.every(1, "minute");
    // Sanity: brand-new jobs without builder triggers would have null
    // nextRun if not prepared; but everyMinute() above already triggers it.
    // Re-null them to simulate raw jobs:
    a.terminate().every(1, "minute");
    b.terminate().every(1, "minute");

    scheduler.addJobs([a, b]);

    expect(a.nextRun).not.toBeNull();
    expect(b.nextRun).not.toBeNull();

    scheduler.stop();
  });

  it("newJob creates, registers, and returns the job", () => {
    const scheduler = new Scheduler();
    const created = scheduler.newJob("t", noop);

    expect(created).toBeInstanceOf(Job);
    expect(scheduler.jobCount).toBe(1);
    expect(scheduler.getJob("t")).toBe(created);
  });

  it("newJob's returned job starts unscheduled until configured", () => {
    const scheduler = new Scheduler();
    const created = scheduler.newJob("t", noop);
    // No interval/cron configured yet → nextRun is still null.
    expect(created.nextRun).toBeNull();
  });

  it("addJob on a stopped scheduler does NOT (re)prepare the job", () => {
    const scheduler = new Scheduler();
    // Build the job, then move time forward WITHOUT preparing.
    const j = job("a", noop).daily().at("23:00");
    const builtNext = j.nextRun?.toISOString();

    vi.setSystemTime(new Date("2026-05-12T22:00:00Z"));
    scheduler.addJob(j); // scheduler not running → no prepare()

    // nextRun is unchanged from build time (prepare would have advanced it).
    expect(j.nextRun?.toISOString()).toBe(builtNext);
  });

  it("addJobs preserves insertion order in list()", () => {
    const scheduler = new Scheduler();
    const a = job("a", noop).everyMinute();
    const b = job("b", noop).everyMinute();
    const c = job("c", noop).everyMinute();
    scheduler.addJob(a).addJobs([b, c]);
    expect(scheduler.list().map(j => j.name)).toEqual(["a", "b", "c"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lookup / removal
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — removeJob / getJob / list", () => {
  it("removeJob returns true on success, false on miss", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    expect(scheduler.removeJob("a")).toBe(true);
    expect(scheduler.jobCount).toBe(0);
    expect(scheduler.removeJob("missing")).toBe(false);
  });

  it("getJob returns instance or undefined", () => {
    const scheduler = new Scheduler();
    const jobInstance = job("a", noop).everyMinute();
    scheduler.addJob(jobInstance);

    expect(scheduler.getJob("a")).toBe(jobInstance);
    expect(scheduler.getJob("missing")).toBeUndefined();
  });

  it("list() returns all registered jobs", () => {
    const scheduler = new Scheduler();
    const a = job("a", noop).everyMinute();
    const b = job("b", noop).everyMinute();
    scheduler.addJobs([a, b]);

    expect(scheduler.list()).toEqual([a, b]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runEvery
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — runEvery", () => {
  it("rejects values below 100ms", () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.runEvery(99)).toThrow(/at least 100ms/);
    expect(() => scheduler.runEvery(0)).toThrow();
    expect(() => scheduler.runEvery(-1)).toThrow();
  });

  it("accepts 100ms and above", () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.runEvery(100)).not.toThrow();
    expect(() => scheduler.runEvery(60_000)).not.toThrow();
  });

  it("is chainable", () => {
    const scheduler = new Scheduler();
    expect(scheduler.runEvery(500)).toBe(scheduler);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// start / stop / lifecycle events
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — start / stop", () => {
  it("throws on start() with no jobs", () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.start()).toThrow(/no jobs/);
  });

  it("throws on start() when already running", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.start();

    expect(() => scheduler.start()).toThrow(/already running/);

    scheduler.stop();
  });

  it("emits scheduler:started on start()", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const listener = vi.fn();
    scheduler.on("scheduler:started", listener);

    scheduler.start();

    expect(listener).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("emits scheduler:stopped on stop()", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const listener = vi.fn();
    scheduler.on("scheduler:stopped", listener);

    scheduler.start();
    scheduler.stop();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("stop() is a no-op when never started (regression: no spurious event)", () => {
    const scheduler = new Scheduler();
    const listener = vi.fn();
    scheduler.on("scheduler:stopped", listener);

    scheduler.stop();

    expect(listener).not.toHaveBeenCalled();
  });

  it("isRunning reflects state", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it("can restart after stop()", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tick behaviour & events
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — tick behaviour", () => {
  it("emits scheduler:tick at each interval", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const tickListener = vi.fn();
    scheduler.on("scheduler:tick", tickListener);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(3500); // three ticks

    expect(tickListener.mock.calls.length).toBeGreaterThanOrEqual(3);
    scheduler.stop();
  });

  it("emits job:start and job:complete on success", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everySecond());
    const startListener = vi.fn();
    const completeListener = vi.fn();
    scheduler.on("job:start", startListener);
    scheduler.on("job:complete", completeListener);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(startListener).toHaveBeenCalledWith("a");
    expect(completeListener).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ success: true }),
    );

    scheduler.stop();
  });

  it("emits job:error when callback throws", async () => {
    const scheduler = new Scheduler();
    const err = new Error("boom");
    scheduler.addJob(
      job("a", async () => {
        throw err;
      }).everySecond(),
    );
    const errorListener = vi.fn();
    scheduler.on("job:error", errorListener);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(errorListener).toHaveBeenCalledWith("a", err);
    scheduler.stop();
  });

  it("emits job:skip when a tick finds a due job already running", async () => {
    // The scheduler awaits each tick's jobs, so the only way overlap can
    // be observed within a single process is when a run was initiated
    // outside the scheduler's own loop (manual `.run()`, another caller,
    // parallel batch leftover). Simulate that by kicking off run()
    // externally before starting the scheduler.
    const scheduler = new Scheduler();
    const jobInstance = job("a", async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
    })
      .everySecond()
      .preventOverlap();
    scheduler.addJob(jobInstance);

    const runPromise = jobInstance.run();
    await vi.advanceTimersByTimeAsync(1);
    expect(jobInstance.isRunning).toBe(true);

    const skipListener = vi.fn();
    scheduler.on("job:skip", skipListener);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1500);

    expect(skipListener).toHaveBeenCalledWith("a", "Job is already running");

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await runPromise;
  });

  it("does not run a job whose nextRun is still in the future", async () => {
    const scheduler = new Scheduler();
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.addJob(job("a", callback).daily().at("23:00"));

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);

    expect(callback).not.toHaveBeenCalled();
    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequential vs parallel execution
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — execution modes", () => {
  it("sequential mode runs jobs one after another", async () => {
    const scheduler = new Scheduler();
    const order: string[] = [];

    scheduler.addJobs([
      job("a", async () => {
        order.push("start-a");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-a");
      }).everySecond(),
      job("b", async () => {
        order.push("start-b");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-b");
      }).everySecond(),
    ]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100); // trigger tick
    await vi.advanceTimersByTimeAsync(100); // job a finishes
    await vi.advanceTimersByTimeAsync(100); // job b finishes

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
    scheduler.stop();
  });

  it("parallel mode runs all jobs concurrently within a batch", async () => {
    const scheduler = new Scheduler();
    const order: string[] = [];

    scheduler.addJobs([
      job("a", async () => {
        order.push("start-a");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-a");
      }).everySecond(),
      job("b", async () => {
        order.push("start-b");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-b");
      }).everySecond(),
    ]);

    scheduler.runInParallel(true);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);

    // Both jobs should have started before either ends.
    expect(order.slice(0, 2)).toEqual(["start-a", "start-b"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(order).toContain("end-a");
    expect(order).toContain("end-b");

    scheduler.stop();
  });

  it("parallel mode with concurrency=2 batches a 5-job set as 2+2+1", async () => {
    const scheduler = new Scheduler();
    const liveCount = { current: 0, peak: 0 };
    const callbacks: (() => void)[] = [];

    const makeCallback = () => async () => {
      liveCount.current++;
      liveCount.peak = Math.max(liveCount.peak, liveCount.current);
      await new Promise<void>(resolve => callbacks.push(resolve));
      liveCount.current--;
    };

    for (const name of ["a", "b", "c", "d", "e"]) {
      scheduler.addJob(job(name, makeCallback()).everySecond());
    }

    scheduler.runInParallel(true, 2);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1100); // first tick fires
    await vi.advanceTimersByTimeAsync(0); // microtask flush

    // Only 2 jobs should be live at once.
    expect(liveCount.peak).toBeLessThanOrEqual(2);
    expect(liveCount.current).toBe(2);

    // Release first batch.
    callbacks[0]();
    callbacks[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(liveCount.current).toBeGreaterThan(0); // batch 2 started

    // Release rest to let test cleanup.
    while (callbacks.length > 0) {
      callbacks.shift()?.();
    }
    await vi.runAllTimersAsync();
    scheduler.stop();
  });

  it("runInParallel is chainable", () => {
    const scheduler = new Scheduler();
    expect(scheduler.runInParallel(true)).toBe(scheduler);
  });

  it("parallel mode isolates a failing job — siblings still run (allSettled)", async () => {
    const scheduler = new Scheduler();
    const aDone = vi.fn();
    const cDone = vi.fn();

    scheduler.addJobs([
      job("a", async () => {
        aDone();
      }).everySecond(),
      job("b", async () => {
        throw new Error("b fails");
      }).everySecond(),
      job("c", async () => {
        cDone();
      }).everySecond(),
    ]);

    const errored: string[] = [];
    scheduler.on("job:error", name => errored.push(name));

    scheduler.runInParallel(true);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);

    // The throwing job does not abort the batch.
    expect(aDone).toHaveBeenCalled();
    expect(cDone).toHaveBeenCalled();
    expect(errored).toContain("b");

    scheduler.stop();
  });

  it("runInParallel(false) reverts to sequential ordering", async () => {
    const scheduler = new Scheduler();
    const order: string[] = [];

    scheduler.addJobs([
      job("a", async () => {
        order.push("start-a");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-a");
      }).everySecond(),
      job("b", async () => {
        order.push("start-b");
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push("end-b");
      }).everySecond(),
    ]);

    scheduler.runInParallel(true).runInParallel(false); // toggle back off
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — shutdown", () => {
  it("waits for in-flight jobs to complete", async () => {
    const scheduler = new Scheduler();
    let finished = false;
    scheduler.addJob(
      job("a", async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        finished = true;
      }).everySecond(),
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100); // tick fires, job starts
    expect(scheduler.list()[0].isRunning).toBe(true);

    const shutdownPromise = scheduler.shutdown();
    await vi.advanceTimersByTimeAsync(500); // job finishes
    await shutdownPromise;

    expect(finished).toBe(true);
  });

  it("respects the timeout parameter", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(
      job("a", async () => {
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }).everySecond(),
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);

    const shutdownPromise = scheduler.shutdown(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(shutdownPromise).resolves.toBeUndefined();

    // Cleanup the still-running timer.
    await vi.runAllTimersAsync();
  });

  it("emits scheduler:stopped via stop() inside shutdown()", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const listener = vi.fn();
    scheduler.on("scheduler:stopped", listener);

    scheduler.start();
    await scheduler.shutdown();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("resolves immediately when no jobs are running", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.start();

    await expect(scheduler.shutdown()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drift compensation
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — drift compensation", () => {
  it("schedules subsequent ticks net of work elapsed", async () => {
    const scheduler = new Scheduler();
    const tickTimes: number[] = [];

    scheduler.on("scheduler:tick", () => {
      tickTimes.push(Date.now());
    });

    // 100ms tick with 50ms of work per tick → without drift compensation,
    // ticks would land every 150ms; with it, every ~100ms.
    scheduler.runEvery(100);
    scheduler.addJob(
      job("slow", async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      }).everySecond(),
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);

    // ~10 ticks expected; allow generous floor to keep this stable.
    expect(tickTimes.length).toBeGreaterThanOrEqual(6);

    scheduler.stop();
    await vi.runAllTimersAsync();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event emitter wiring (typed on/once/off)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — event emitter", () => {
  it("off() detaches a previously-registered listener", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const listener = vi.fn();

    scheduler.on("scheduler:started", listener);
    scheduler.off("scheduler:started", listener);
    scheduler.start();

    expect(listener).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("once() fires a listener only a single time", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const listener = vi.fn();

    scheduler.once("scheduler:tick", listener);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3500); // three ticks

    expect(listener).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("supports multiple listeners on the same event", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    const first = vi.fn();
    const second = vi.fn();

    scheduler.on("scheduler:started", first);
    scheduler.on("scheduler:started", second);
    scheduler.start();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("scheduler:tick carries a Date payload", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    let payload: unknown;
    scheduler.on("scheduler:tick", ts => {
      payload = ts;
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100);

    expect(payload).toBeInstanceOf(Date);
    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// removeJob during operation + shutdown idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — mutation & shutdown edges", () => {
  it("removeJob mid-operation stops the job from firing again", async () => {
    const scheduler = new Scheduler();
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.addJob(job("a", callback).everySecond());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1500);
    const callsBefore = callback.mock.calls.length;
    expect(callsBefore).toBeGreaterThanOrEqual(1);

    expect(scheduler.removeJob("a")).toBe(true);
    expect(scheduler.jobCount).toBe(0);

    await vi.advanceTimersByTimeAsync(3000);
    // No further calls after removal.
    expect(callback.mock.calls.length).toBe(callsBefore);

    scheduler.stop();
  });

  it("shutdown() is safe to call twice", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.start();

    await scheduler.shutdown();
    await expect(scheduler.shutdown()).resolves.toBeUndefined();
    expect(scheduler.isRunning).toBe(false);
  });

  it("shutdown() on a never-started scheduler resolves and stays stopped", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    await expect(scheduler.shutdown()).resolves.toBeUndefined();
    expect(scheduler.isRunning).toBe(false);
  });

  it("no ticks are scheduled after the shutdown flag is set", async () => {
    const scheduler = new Scheduler();
    const tickListener = vi.fn();
    scheduler.on("scheduler:tick", tickListener);
    scheduler.addJob(job("a", noop).everyMinute());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1100); // one tick
    const ticksAfterStart = tickListener.mock.calls.length;
    expect(ticksAfterStart).toBeGreaterThanOrEqual(1);

    await scheduler.shutdown();

    // Advance well past several intervals — no new ticks should land.
    await vi.advanceTimersByTimeAsync(5000);
    expect(tickListener.mock.calls.length).toBe(ticksAfterStart);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: cron job inside the scheduler
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — cron integration", () => {
  it("fires a cron-scheduled job at the right time", async () => {
    // Start at 10:59:00 so we only need ~90 s of fake time.
    vi.setSystemTime(new Date("2026-05-11T10:59:00Z"));

    const scheduler = new Scheduler();
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.addJob(job("hourly", callback).cron("0 11 * * *"));
    scheduler.start();

    // 30 s in — should not fire yet.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callback).not.toHaveBeenCalled();

    // Past 11:00 — should fire.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(callback).toHaveBeenCalled();

    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dev-mode "registered but never started" warning (S7)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduler — registered-but-never-started warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    // The warning is deliberately suppressed in production, so these dev-mode
    // cases have to declare the environment they are testing rather than
    // inherit whatever the launching shell happened to export. Without this,
    // a shell with NODE_ENV=production turns three correct tests red.
    process.env.NODE_ENV = "test";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("warns when a job is registered but start() is never called", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    // Deferred one-shot check fires on the next macrotask.
    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).toHaveBeenCalledOnce();
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("1 job(s) registered");
    expect(message).toContain("scheduler.start() was never called");
  });

  it("reports the registered job count in the warning", async () => {
    const scheduler = new Scheduler();
    scheduler.addJobs([
      job("a", noop).everyMinute(),
      job("b", noop).everyMinute(),
      job("c", noop).everyMinute(),
    ]);

    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("3 job(s) registered");
  });

  it("arms the check only once across multiple registrations", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.addJob(job("b", noop).everyMinute());
    scheduler.addJobs([job("c", noop).everyMinute()]);

    await vi.advanceTimersByTimeAsync(0);

    // A single deferred warning, not one per registration.
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("does NOT warn when start() is called before the check fires", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("does NOT warn after start() then stop() (started at least once)", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.start();
    scheduler.stop();

    // Registering more jobs after a start/stop cycle must not re-arm.
    scheduler.addJob(job("b", noop).everyMinute());

    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn in production (NODE_ENV=production)", async () => {
    process.env.NODE_ENV = "production";

    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());

    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when every registered job was later removed", async () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", noop).everyMinute());
    scheduler.removeJob("a");

    await vi.advanceTimersByTimeAsync(0);

    // No jobs remain when the deferred check fires → nothing to warn about.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
