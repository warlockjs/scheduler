import { afterEach, describe, expect, it, vi } from "vitest";
import { job } from "./job";
import { Scheduler } from "./scheduler";

describe("Scheduler.start() — role gating", () => {
  afterEach(() => {
    delete process.env.WARLOCK_ROLES;
    vi.restoreAllMocks();
  });

  it("does not start and logs when the process lacks the worker role", () => {
    process.env.WARLOCK_ROLES = "web";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", async () => {}).everyMinute());

    scheduler.start();

    expect(scheduler.isRunning).toBe(false);
    expect(info).toHaveBeenCalledWith("scheduler: not started (role: web)");
  });

  it("starts as usual when no role restriction is set", () => {
    const scheduler = new Scheduler();
    scheduler.addJob(job("a", async () => {}).everyMinute());

    scheduler.start();

    expect(scheduler.isRunning).toBe(true);

    scheduler.stop();
  });
});
