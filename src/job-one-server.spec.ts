import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Job } from "./job";

const held = new Set<string>();
const lockKeys: string[] = [];

// Fake shared cache: a create-only set succeeds only for the first caller per
// key, and the claim is never released (it only expires).
vi.mock("@warlock.js/cache", () => ({
  cache: {
    set: async (key: string, _value: unknown, options: { onConflict?: string }) => {
      lockKeys.push(key);

      if (options?.onConflict !== "create") throw new Error("expected a create-only claim");
      if (held.has(key)) return { wasSet: false, existing: "other" };

      held.add(key);

      return { wasSet: true, existing: null };
    },
  },
}));

const NOW = new Date("2026-05-11T10:00:00.400Z");

beforeEach(() => {
  held.clear();
  lockKeys.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Job.onOneServer()", () => {
  it("runs the handler once per tick across two servers with the same key", async () => {
    const handler = vi.fn(async () => {});
    const a = new Job("report", handler).everyMinute().onOneServer();
    const b = new Job("report", handler).everyMinute().onOneServer();

    vi.setSystemTime(new Date(a.nextRun!.valueOf() + 300));
    const [ra, rb] = await Promise.all([a.run(), b.run()]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect([ra.skipped, rb.skipped].filter(Boolean)).toHaveLength(1);
    expect(lockKeys[0]).toBe(lockKeys[1]);
    expect(lockKeys[0]).toMatch(/^scheduler\.report\.\d+000$/);
  });

  it("a server whose tick fires late, after the winner finished, still skips that tick", async () => {
    const handler = vi.fn(async () => {});
    const a = new Job("report", handler).everyMinute().onOneServer();
    const b = new Job("report", handler).everyMinute().onOneServer();
    const tick = a.nextRun!.valueOf();

    vi.setSystemTime(new Date(tick + 300));
    await a.run();

    vi.setSystemTime(new Date(tick + 5_000));
    const late = await b.run();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(late.skipped).toBe(true);
  });

  it("honors a custom key", async () => {
    const j = new Job("x", async () => {}).everyMinute().onOneServer({ key: "shared" });

    await j.run();

    expect(lockKeys[0]).toMatch(/^scheduler\.shared\.\d+000$/);
  });

  it("throws when the job has no name or key", () => {
    expect(() => new Job("", async () => {}).onOneServer()).toThrow(/stable across servers/);
  });
});
