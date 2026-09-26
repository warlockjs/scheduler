import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import { Scheduler } from "./scheduler";

describe("scheduler.around", () => {
  it("wraps the callback so context is visible inside it", async () => {
    const scheduler = new Scheduler();
    const storage = new AsyncLocalStorage<string>();
    let seen: string | undefined;

    scheduler.around((job, run) => storage.run(`ctx:${job.name}`, run));
    const j = scheduler.newJob("a", async () => {
      seen = storage.getStore();
    });

    const result = await j.run();

    expect(result.success).toBe(true);
    expect(seen).toBe("ctx:a");
  });

  it("composes with the first registered hook outermost", async () => {
    const scheduler = new Scheduler();
    const order: string[] = [];

    scheduler.around(async (_job, run) => {
      order.push("outer:in");
      const value = await run();
      order.push("outer:out");
      return value;
    });
    scheduler.around(async (_job, run) => {
      order.push("inner:in");
      const value = await run();
      order.push("inner:out");
      return value;
    });

    await scheduler
      .newJob("a", async () => {
        order.push("cb");
      })
      .run();

    expect(order).toEqual(["outer:in", "inner:in", "cb", "inner:out", "outer:out"]);
  });

  it("wraps every retry attempt", async () => {
    const scheduler = new Scheduler();
    let wraps = 0;
    let calls = 0;

    scheduler.around((_job, run) => {
      wraps++;
      return run();
    });

    const result = await scheduler
      .newJob("a", async () => {
        calls++;
        if (calls < 3) throw new Error("boom");
      })
      .retry(2, 0)
      .run();

    expect(result.success).toBe(true);
    expect(calls).toBe(3);
    expect(wraps).toBe(3);
  });

  it("treats a hook that never calls run as a skip and emits job:skip", async () => {
    const scheduler = new Scheduler();
    const skips: unknown[][] = [];
    let called = false;

    scheduler.on("job:skip", (...args: unknown[]) => skips.push(args));
    scheduler.around(async () => undefined);

    const j = scheduler.newJob("a", async () => {
      called = true;
    });
    const result = await (
      scheduler as unknown as { _runJob(j: unknown): Promise<{ skipped?: boolean }> }
    )._runJob(j);

    expect(called).toBe(false);
    expect(result.skipped).toBe(true);
    expect(skips).toHaveLength(1);
  });

  it("treats a throwing hook like a callback error", async () => {
    const scheduler = new Scheduler();

    scheduler.around(async () => {
      throw new Error("hook failed");
    });

    const result = await scheduler.newJob("a", async () => {}).run();

    expect(result.success).toBe(false);
  });

  it("stops wrapping after unsubscribe", async () => {
    const scheduler = new Scheduler();
    let wraps = 0;

    const off = scheduler.around((_job, run) => {
      wraps++;
      return run();
    });
    const j = scheduler.newJob("a", async () => {});

    await j.run();
    off();
    await j.run();

    expect(wraps).toBe(1);
  });
});
