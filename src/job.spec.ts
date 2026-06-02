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

beforeAll(() => {
  dayjs.extend(utc);
  dayjs.extend(timezone);
});

const NOW = new Date("2026-05-11T10:00:00Z"); // Monday 10:00 UTC

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const noop = async () => {};

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — construction", () => {
  it("`new Job` stores the name and starts idle", () => {
    const j = new Job("test", noop);
    expect(j.name).toBe("test");
    expect(j.nextRun).toBeNull();
    expect(j.lastRun).toBeNull();
    expect(j.isRunning).toBe(false);
    expect(j.intervals).toEqual({});
    expect(j.cronExpression).toBeNull();
  });

  it("`job()` factory returns a Job instance", () => {
    const j = job("test", noop);
    expect(j).toBeInstanceOf(Job);
    expect(j.name).toBe("test");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fluent interval builders
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — fluent interval builders", () => {
  it("everySecond / everySeconds", () => {
    expect(job("t", noop).everySecond().intervals.every).toEqual({
      value: 1,
      type: "second",
    });
    expect(job("t", noop).everySeconds(30).intervals.every).toEqual({
      value: 30,
      type: "second",
    });
  });

  it("everyMinute / everyMinutes / always", () => {
    expect(job("t", noop).everyMinute().intervals.every).toEqual({
      value: 1,
      type: "minute",
    });
    expect(job("t", noop).everyMinutes(15).intervals.every).toEqual({
      value: 15,
      type: "minute",
    });
    expect(job("t", noop).always().intervals.every).toEqual({
      value: 1,
      type: "minute",
    });
  });

  it("everyHour / everyHours / twiceDaily", () => {
    expect(job("t", noop).everyHour().intervals.every).toEqual({
      value: 1,
      type: "hour",
    });
    expect(job("t", noop).everyHours(6).intervals.every).toEqual({
      value: 6,
      type: "hour",
    });
    expect(job("t", noop).twiceDaily().intervals.every).toEqual({
      value: 12,
      type: "hour",
    });
  });

  it("daily / everyDay", () => {
    expect(job("t", noop).daily().intervals.every).toEqual({
      value: 1,
      type: "day",
    });
    expect(job("t", noop).everyDay().intervals.every).toEqual({
      value: 1,
      type: "day",
    });
  });

  it("weekly / everyWeek", () => {
    expect(job("t", noop).weekly().intervals.every).toEqual({
      value: 1,
      type: "week",
    });
  });

  it("monthly / everyMonth", () => {
    expect(job("t", noop).monthly().intervals.every).toEqual({
      value: 1,
      type: "month",
    });
  });

  it("yearly / everyYear", () => {
    expect(job("t", noop).yearly().intervals.every).toEqual({
      value: 1,
      type: "year",
    });
  });

  it("every() is chainable", () => {
    const j = job("t", noop);
    expect(j.every(5, "minute")).toBe(j);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// every() validation (P0 regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — every() validation", () => {
  it("rejects zero", () => {
    expect(() => job("t", noop).every(0, "minute")).toThrow(/positive finite/);
  });

  it("rejects negative", () => {
    expect(() => job("t", noop).every(-1, "minute")).toThrow(/positive finite/);
  });

  it("rejects NaN", () => {
    expect(() => job("t", noop).every(NaN, "minute")).toThrow(/positive finite/);
  });

  it("rejects Infinity", () => {
    expect(() => job("t", noop).every(Infinity, "minute")).toThrow(
      /positive finite/,
    );
  });

  it("accepts positive integer and decimal values", () => {
    expect(() => job("t", noop).every(1, "minute")).not.toThrow();
    expect(() => job("t", noop).every(0.5, "minute")).not.toThrow();
    expect(() => job("t", noop).every(1000, "minute")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// at() validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — at() validation", () => {
  it("accepts HH:mm", () => {
    expect(() => job("t", noop).at("09:30")).not.toThrow();
  });

  it("accepts HH:mm:ss", () => {
    expect(() => job("t", noop).at("09:30:45")).not.toThrow();
  });

  it("accepts single-digit hour", () => {
    expect(() => job("t", noop).at("9:30")).not.toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => job("t", noop).at("foo")).toThrow(/Invalid time format/);
    expect(() => job("t", noop).at("")).toThrow(/Invalid time format/);
    expect(() => job("t", noop).at("9-30")).toThrow(/Invalid time format/);
  });

  it("rejects hour > 23", () => {
    expect(() => job("t", noop).at("24:00")).toThrow(/Invalid hour/);
    expect(() => job("t", noop).at("25:00")).toThrow(/Invalid hour/);
  });

  it("rejects minute > 59", () => {
    expect(() => job("t", noop).at("23:60")).toThrow(/Invalid minute/);
  });

  it("rejects second > 59", () => {
    expect(() => job("t", noop).at("23:59:60")).toThrow(/Invalid second/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// on() validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — on() validation", () => {
  it("accepts day-of-month 1 and 31", () => {
    expect(() => job("t", noop).on(1)).not.toThrow();
    expect(() => job("t", noop).on(31)).not.toThrow();
  });

  it("rejects 0 and 32", () => {
    expect(() => job("t", noop).on(0)).toThrow(/between 1 and 31/);
    expect(() => job("t", noop).on(32)).toThrow(/between 1 and 31/);
    expect(() => job("t", noop).on(-1)).toThrow(/between 1 and 31/);
  });

  it("accepts day-of-week strings", () => {
    expect(() => job("t", noop).on("monday")).not.toThrow();
    expect(() => job("t", noop).on("sunday")).not.toThrow();
  });

  it("marks numeric day with dayOfMonthMode = 'specific'", () => {
    const j = job("t", noop).on(15);
    expect(j.intervals.dayOfMonthMode).toBe("specific");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retry() validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — retry() validation", () => {
  it("accepts valid configuration", () => {
    expect(() => job("t", noop).retry(3)).not.toThrow();
    expect(() => job("t", noop).retry(3, 1000)).not.toThrow();
    expect(() => job("t", noop).retry(3, 1000, 2)).not.toThrow();
    expect(() => job("t", noop).retry(0)).not.toThrow(); // 0 retries = no retry
  });

  it("rejects negative maxRetries", () => {
    expect(() => job("t", noop).retry(-1)).toThrow(/maxRetries/);
  });

  it("rejects NaN maxRetries", () => {
    expect(() => job("t", noop).retry(NaN)).toThrow(/maxRetries/);
  });

  it("rejects negative delay", () => {
    expect(() => job("t", noop).retry(3, -100)).toThrow(/delay/);
  });

  it("rejects zero / negative / NaN backoff multiplier", () => {
    expect(() => job("t", noop).retry(3, 1000, 0)).toThrow(/backoffMultiplier/);
    expect(() => job("t", noop).retry(3, 1000, -1)).toThrow(
      /backoffMultiplier/,
    );
    expect(() => job("t", noop).retry(3, 1000, NaN)).toThrow(
      /backoffMultiplier/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextRun — fluent API
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — nextRun calculation (fluent)", () => {
  it("everyMinute with no time fires immediately on first tick", () => {
    // No `at()` → no time constraint → nextRun == now → first tick runs.
    const j = job("t", noop).everyMinute();
    expect(j.nextRun?.toISOString()).toBe(dayjs(NOW).toISOString());
  });

  it("daily().at('11:00') fires today when called before 11:00", () => {
    const j = job("t", noop).daily().at("11:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-11 11:00");
  });

  it("daily().at('09:00') rolls to tomorrow when already past", () => {
    const j = job("t", noop).daily().at("09:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-12 09:00");
  });

  it("weekly().on('monday').at('09:00') from past Monday → next Monday", () => {
    // NOW is Monday 10:00, this Monday 09:00 is past → next Monday May 18.
    const j = job("t", noop).weekly().on("monday").at("09:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-18 09:00");
  });

  it("weekly().on('friday').at('09:00') from Monday → this Friday", () => {
    const j = job("t", noop).weekly().on("friday").at("09:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-15 09:00");
  });

  it("monthly().on(15) advances day-of-month", () => {
    const j = job("t", noop).monthly().on(15);
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-05-15");
  });

  it("twiceDaily().at('06:00') from 10:00 → 18:00 today", () => {
    // applyConstraints sets the time to 06:00 today; that's in the past, so
    // the advance loop adds 12h once → 18:00 today (still in the future, stop).
    // The +12h advance survives because re-applying the time inside the loop
    // is intentionally NOT done (it would deadlock 06:00 ⇄ 18:00).
    const j = job("t", noop).twiceDaily().at("06:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-11 18:00");
  });

  it("monthly().on(31) lands on May 31 from May 11 (no at → keeps current time)", () => {
    const j = job("t", noop).monthly().on(31);
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-31 10:00");
  });

  it("on() with an unrecognized day string is silently ignored (time-only)", () => {
    // _applyConstraints' DAYS_OF_WEEK.indexOf(...) returns -1 for a bad string,
    // so the day constraint is dropped and only the time applies.
    // @ts-expect-error intentionally passing an invalid day name
    const j = job("t", noop).on("notaday").at("09:00");
    expect(j.intervals.day).toBe("notaday");
    // 09:00 today already passed (now is 10:00) → rolls to tomorrow 09:00.
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-12 09:00");
  });

  it("everyWeek().at('09:00') from Mon 10:00 → next Mon 09:00", () => {
    const j = job("t", noop).everyWeek().at("09:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-18 09:00");
  });

  it("on(number) sets dayOfMonthMode 'specific' and survives interval advance", () => {
    const j = job("t", noop).monthly().on(20);
    expect(j.intervals.dayOfMonthMode).toBe("specific");
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-05-20");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// beginOf / endOf — the bugs we fixed
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — beginOf / endOf", () => {
  it("beginOf('day') → tomorrow 00:00 when called mid-day", () => {
    const j = job("t", noop).beginOf("day");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-12 00:00");
  });

  it("endOf('day') → today 23:59", () => {
    const j = job("t", noop).endOf("day");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-11 23:59");
  });

  it("beginOf('month') → 1st of next month at 00:00", () => {
    const j = job("t", noop).beginOf("month");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-06-01 00:00");
  });

  it("endOf('month') resolves to dynamic last day (May = 31)", () => {
    const j = job("t", noop).endOf("month");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-31 23:59");
  });

  it("endOf('month') recomputes last day across Feb → Mar (non-leap)", () => {
    // Regression for the snapshot-at-definition-time bug.
    vi.setSystemTime(new Date("2026-02-15T10:00:00Z"));
    const j = job("t", noop).endOf("month");
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-02-28");

    // Move into March, recompute → should now be March 31, NOT Feb 28.
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    j.prepare();
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-03-31");
  });

  it("endOf('month') leap year February resolves to Feb 29", () => {
    vi.setSystemTime(new Date("2028-02-15T00:00:00Z"));
    const j = job("t", noop).endOf("month");
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2028-02-29");
  });

  it("beginOf('year') locks month to January (regression)", () => {
    // From May → next is Jan 1 NEXT YEAR, NOT May 1 next year.
    const j = job("t", noop).beginOf("year");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2027-01-01 00:00");
  });

  it("endOf('year') locks month to December (regression)", () => {
    const j = job("t", noop).endOf("year");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-12-31 23:59");
  });

  it("beginOf() rejects unsupported types", () => {
    expect(() => job("t", noop).beginOf("week")).toThrow();
    expect(() => job("t", noop).beginOf("hour")).toThrow();
  });

  it("endOf() rejects unsupported types", () => {
    expect(() => job("t", noop).endOf("week")).toThrow();
    expect(() => job("t", noop).endOf("hour")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cron()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — cron()", () => {
  it("clears interval config when switching to cron", () => {
    const j = job("t", noop).everyMinute().cron("0 9 * * *");
    expect(j.intervals).toEqual({});
    expect(j.cronExpression).toBe("0 9 * * *");
  });

  it("cronExpression is null when not using cron", () => {
    expect(job("t", noop).daily().cronExpression).toBeNull();
  });

  it("calculates nextRun from cron", () => {
    const j = job("t", noop).cron("0 11 * * *");
    expect(j.nextRun?.format("HH:mm")).toBe("11:00");
  });

  it("throws on invalid cron expression", () => {
    expect(() => job("t", noop).cron("not a cron")).toThrow();
    expect(() => job("t", noop).cron("* * *")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inTimezone()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — inTimezone()", () => {
  it("defaults to UTC", () => {
    const j = job("t", noop).daily().at("11:00");
    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-05-11 11:00");
  });

  it("shifts schedule to specified IANA zone (America/New_York, EDT in May)", () => {
    const j = job("t", noop).daily().at("09:00").inTimezone("America/New_York");
    // 9 AM NY (EDT, UTC-4) = 13:00 UTC.
    expect(j.nextRun?.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });

  it("Asia/Tokyo (UTC+9, no DST)", () => {
    const j = job("t", noop).daily().at("09:00").inTimezone("Asia/Tokyo");
    // 9 AM Tokyo = 00:00 UTC. NOW is 10:00 UTC, so 00:00 today already passed →
    // next is tomorrow 00:00 UTC.
    expect(j.nextRun?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isDue()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — isDue()", () => {
  it("returns false when nextRun is null (never scheduled)", () => {
    expect(job("t", noop).isDue()).toBe(false);
  });

  it("returns false when nextRun is in the future", () => {
    expect(job("t", noop).daily().at("11:00").isDue()).toBe(false);
  });

  it("returns true at the exact nextRun boundary (isSameOrAfter)", () => {
    const j = job("t", noop).daily().at("11:00");
    vi.setSystemTime(new Date("2026-05-11T11:00:00Z"));
    expect(j.isDue()).toBe(true);
  });

  it("returns true when nextRun is in the past", () => {
    const j = job("t", noop).daily().at("11:00");
    vi.setSystemTime(new Date("2026-05-11T11:00:30Z"));
    expect(j.isDue()).toBe(true);
  });

  it("ignores running state — unlike shouldRun(), it is purely time-based", async () => {
    const j = job("t", async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    })
      .everyMinute()
      .preventOverlap();

    const promise = j.run();
    await vi.advanceTimersByTimeAsync(1);

    // While running, shouldRun() short-circuits to false but isDue() does not.
    expect(j.isRunning).toBe(true);
    expect(j.shouldRun()).toBe(false);
    expect(j.isDue()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldRun()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — shouldRun()", () => {
  it("returns false when nextRun is null", () => {
    expect(job("t", noop).shouldRun()).toBe(false);
  });

  it("returns false when nextRun is in the future", () => {
    expect(job("t", noop).daily().at("09:00").shouldRun()).toBe(false);
  });

  it("returns true at the exact tick boundary (isSameOrAfter)", () => {
    const j = job("t", noop).daily().at("11:00");
    vi.setSystemTime(new Date("2026-05-11T11:00:00Z"));
    expect(j.shouldRun()).toBe(true);
  });

  it("returns true when nextRun is in the past", () => {
    const j = job("t", noop).daily().at("11:00");
    vi.setSystemTime(new Date("2026-05-11T11:00:30Z"));
    expect(j.shouldRun()).toBe(true);
  });

  it("preventOverlap + already running → false", async () => {
    const j = job("t", async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    })
      .everyMinute()
      .preventOverlap();

    const promise = j.run();
    await vi.advanceTimersByTimeAsync(1);
    expect(j.isRunning).toBe(true);
    expect(j.shouldRun()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run() — success
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — run() success path", () => {
  it("invokes callback with the job instance", async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const j = job("t", callback).everyMinute();
    await j.run();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(j);
  });

  it("returns success result with duration and zero retries", async () => {
    const j = job("t", noop).everyMinute();
    const result = await j.run();
    expect(result.success).toBe(true);
    expect(result.duration).toBeTypeOf("number");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.retries).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("advances nextRun and sets lastRun on success", async () => {
    const j = job("t", noop).everyMinute();
    const initialNext = j.nextRun;
    expect(j.lastRun).toBeNull();

    await j.run();

    expect(j.lastRun).not.toBeNull();
    expect(j.nextRun?.isAfter(initialNext!)).toBe(true);
  });

  it("clears isRunning after completion", async () => {
    const j = job("t", noop).everyMinute();
    await j.run();
    expect(j.isRunning).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run() — interval honored on reschedule (regression: fast-completing jobs)
//
// After a run, nextRun must jump ahead by EXACTLY one interval from lastRun.
// A prior bug used `lastRun + 1s` and relied on the catch-up loop, which only
// fires when the candidate is already in the past — so a fast callback left
// `everySeconds(2)` firing every second.
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — interval honored after run", () => {
  it("everySeconds(2): nextRun is lastRun + 2s, not lastRun + 1s", async () => {
    const j = job("t", noop).everySeconds(2);

    await j.run();

    const lastRun = j.lastRun!;
    const nextRun = j.nextRun!;

    expect(nextRun.diff(lastRun, "second")).toBe(2);
    expect(nextRun.toISOString()).toBe(lastRun.add(2, "second").toISOString());
  });

  it("everyMinutes(5): nextRun advances a full 5 minutes from lastRun", async () => {
    const j = job("t", noop).everyMinutes(5);

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "minute")).toBe(5);
  });

  it("everyHours(3): nextRun advances a full 3 hours from lastRun", async () => {
    const j = job("t", noop).everyHours(3);

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "hour")).toBe(3);
  });

  it("advances by the interval even after a FAILED run", async () => {
    const j = job("t", async () => {
      throw new Error("boom");
    }).everySeconds(30);

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "second")).toBe(30);
  });

  it("everyDay(): nextRun advances a full 24 hours from lastRun", async () => {
    const j = job("t", noop).everyDay();

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "hour")).toBe(24);
  });

  it("everyWeek(): nextRun advances a full 7 days from lastRun", async () => {
    const j = job("t", noop).everyWeek();

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "day")).toBe(7);
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-05-18");
  });

  it("everyMonth(): nextRun advances exactly one calendar month", async () => {
    const j = job("t", noop).everyMonth();

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "month")).toBe(1);
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-06-11");
  });

  it("everyYear(): nextRun advances exactly twelve months", async () => {
    const j = job("t", noop).everyYear();

    await j.run();

    expect(j.nextRun!.diff(j.lastRun!, "month")).toBe(12);
  });

  it("endOf('month'): after a Jan-31 run, nextRun is Feb's last day (28)", async () => {
    // Regression: the dynamic last-day must be recomputed for the NEW month
    // after advancing, not snapshotted at definition time.
    vi.setSystemTime(new Date("2026-01-31T23:59:00Z"));
    const j = job("t", noop).endOf("month");
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-01-31");

    await j.run();

    expect(j.nextRun?.format("YYYY-MM-DD HH:mm")).toBe("2026-02-28 23:59");
  });

  it("cron job: nextRun is recomputed from now after a run (ignores lastRun)", async () => {
    // Cron scheduling reads `_now()` directly, so lastRun does not shift it.
    const j = job("t", noop).cron("*/5 * * * *");
    const before = j.nextRun?.format();

    await j.run();

    expect(j.nextRun?.format()).toBe(before);
    expect(j.cronExpression).toBe("*/5 * * * *");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run() — failure
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — run() failure path", () => {
  it("returns failure result with the thrown error", async () => {
    const err = new Error("boom");
    const j = job("t", async () => {
      throw err;
    }).everyMinute();
    const result = await j.run();
    expect(result.success).toBe(false);
    expect(result.error).toBe(err);
  });

  it("ADVANCES nextRun even on failure (regression: P0 #1)", async () => {
    const j = job("t", async () => {
      throw new Error("boom");
    }).everyMinute();
    const initialNext = j.nextRun;

    await j.run();

    expect(j.nextRun?.isAfter(initialNext!)).toBe(true);
  });

  it("sets lastRun on failure so subsequent _determineNextRun moves forward", async () => {
    const j = job("t", async () => {
      throw new Error("boom");
    }).everyMinute();

    await j.run();

    expect(j.lastRun).not.toBeNull();
  });

  it("clears isRunning after failure", async () => {
    const j = job("t", async () => {
      throw new Error("boom");
    }).everyMinute();
    await j.run();
    expect(j.isRunning).toBe(false);
  });

  it("reports maxRetries on permanent failure", async () => {
    const j = job("t", async () => {
      throw new Error("fail");
    })
      .everyMinute()
      .retry(3, 0);
    const promise = j.run();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.retries).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run() — retry behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — retry behaviour", () => {
  it("retries up to maxRetries before giving up", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      throw new Error("fail");
    })
      .everyMinute()
      .retry(3, 0);

    const promise = j.run();
    await vi.runAllTimersAsync();
    await promise;
    expect(attempts).toBe(4); // initial + 3 retries
  });

  it("returns the retry count when succeeding mid-retry", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
    })
      .everyMinute()
      .retry(5, 0);

    const promise = j.run();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.retries).toBe(2);
  });

  it("respects fixed retry delay", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      throw new Error("fail");
    })
      .everyMinute()
      .retry(2, 100);

    const promise = j.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(3);

    await promise;
  });

  it("exponential backoff multiplies delay by multiplier^(attempt-1)", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      throw new Error("fail");
    })
      .everyMinute()
      .retry(3, 100, 2);

    const promise = j.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // 100 × 2^0 = 100ms before attempt 2
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(2);

    // 100 × 2^1 = 200ms before attempt 3
    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toBe(3);

    // 100 × 2^2 = 400ms before attempt 4
    await vi.advanceTimersByTimeAsync(400);
    expect(attempts).toBe(4);

    await promise;
  });

  it("retry(0) = no retries (single attempt)", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      throw new Error("fail");
    })
      .everyMinute()
      .retry(0);

    const promise = j.run();
    await vi.runAllTimersAsync();
    await promise;
    expect(attempts).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// preventOverlap()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — preventOverlap()", () => {
  it("default false — shouldRun does NOT short-circuit on running", () => {
    const j = job("t", noop).everyMinute();
    expect(j["_skipIfRunning" as never]).toBe(false);
  });

  it("preventOverlap(true) sets the skip flag", () => {
    const j = job("t", noop).everyMinute().preventOverlap();
    expect(j["_skipIfRunning" as never]).toBe(true);
  });

  it("preventOverlap(false) explicitly disables skipping", () => {
    const j = job("t", noop).everyMinute().preventOverlap().preventOverlap(false);
    expect(j["_skipIfRunning" as never]).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// terminate()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — terminate()", () => {
  it("clears interval config, nextRun, and lastRun", async () => {
    const j = job("t", noop).daily().at("09:00");
    await j.run();
    expect(j.lastRun).not.toBeNull();

    j.terminate();
    expect(j.intervals).toEqual({});
    expect(j.nextRun).toBeNull();
    expect(j.lastRun).toBeNull();
  });

  it("clears cron parser (regression)", () => {
    const j = job("t", noop).cron("0 9 * * *");
    expect(j.cronExpression).toBe("0 9 * * *");

    j.terminate();
    expect(j.cronExpression).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// waitForCompletion()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — waitForCompletion()", () => {
  it("resolves immediately when not running", async () => {
    const j = job("t", noop).everyMinute();
    await expect(j.waitForCompletion()).resolves.toBeUndefined();
  });

  it("waits until a running job finishes", async () => {
    let finished = false;
    const j = job("t", async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      finished = true;
    }).everyMinute();

    const runPromise = j.run();
    await vi.advanceTimersByTimeAsync(1);

    const waitPromise = j.waitForCompletion();
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([runPromise, waitPromise]);

    expect(finished).toBe(true);
  });

  it("resolves ALL concurrent waiters (regression: resolver overwrite bug)", async () => {
    const j = job("t", async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    }).everyMinute();

    const runPromise = j.run();
    await vi.advanceTimersByTimeAsync(1);

    const waiters = [
      j.waitForCompletion(),
      j.waitForCompletion(),
      j.waitForCompletion(),
    ];

    await vi.advanceTimersByTimeAsync(100);

    await expect(Promise.all(waiters)).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    await runPromise;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prepare()
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — prepare()", () => {
  it("recomputes nextRun based on current time", () => {
    const j = job("t", noop).daily().at("11:00");
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-05-11");

    vi.setSystemTime(new Date("2026-05-12T12:00:00Z"));
    j.prepare();
    expect(j.nextRun?.format("YYYY-MM-DD")).toBe("2026-05-13");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// beginOf / endOf — interval shape (not just nextRun)
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — beginOf / endOf interval configuration", () => {
  it("beginOf('day') sets a daily interval at 00:00", () => {
    const j = job("t", noop).beginOf("day");
    expect(j.intervals.every).toEqual({ type: "day", value: 1 });
    expect(j.intervals.time).toBe("00:00");
  });

  it("endOf('day') sets a daily interval at 23:59", () => {
    const j = job("t", noop).endOf("day");
    expect(j.intervals.every).toEqual({ type: "day", value: 1 });
    expect(j.intervals.time).toBe("23:59");
  });

  it("beginOf('month') pins day 1 ('specific') with a monthly interval", () => {
    const j = job("t", noop).beginOf("month");
    expect(j.intervals.day).toBe(1);
    expect(j.intervals.dayOfMonthMode).toBe("specific");
    expect(j.intervals.every).toEqual({ type: "month", value: 1 });
    expect(j.intervals.time).toBe("00:00");
  });

  it("endOf('month') uses dayOfMonthMode 'last' rather than a fixed day", () => {
    const j = job("t", noop).endOf("month");
    expect(j.intervals.dayOfMonthMode).toBe("last");
    expect(j.intervals.day).toBeUndefined();
    expect(j.intervals.every).toEqual({ type: "month", value: 1 });
  });

  it("beginOf('year') locks month=1, day=1 with a yearly interval", () => {
    const j = job("t", noop).beginOf("year");
    expect(j.intervals.month).toBe(1);
    expect(j.intervals.day).toBe(1);
    expect(j.intervals.dayOfMonthMode).toBe("specific");
    expect(j.intervals.every).toEqual({ type: "year", value: 1 });
  });

  it("endOf('year') locks month=12, day=31 with a yearly interval", () => {
    const j = job("t", noop).endOf("year");
    expect(j.intervals.month).toBe(12);
    expect(j.intervals.day).toBe(31);
    expect(j.intervals.every).toEqual({ type: "year", value: 1 });
    expect(j.intervals.time).toBe("23:59");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inTimezone() — recomputation
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — inTimezone() recomputation", () => {
  it("changing the timezone recomputes nextRun", () => {
    const j = job("t", noop).daily().at("09:00");
    // UTC: 09:00 already passed (now 10:00 UTC) → tomorrow 09:00 UTC.
    expect(j.nextRun?.toISOString()).toBe("2026-05-12T09:00:00.000Z");

    j.inTimezone("America/New_York");
    // 09:00 NY (EDT, UTC-4) = 13:00 UTC today, still ahead of 10:00 UTC → today.
    expect(j.nextRun?.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });

  it("is chainable and returns the same job instance", () => {
    const j = job("t", noop).daily();
    expect(j.inTimezone("UTC")).toBe(j);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retry() — fixed-delay path (no backoff multiplier)
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — retry fixed delay (no backoff)", () => {
  it("uses a constant delay between every attempt", async () => {
    let attempts = 0;
    const j = job("t", async () => {
      attempts++;
      throw new Error("fail");
    })
      .everyMinute()
      .retry(3, 100); // no multiplier → flat 100ms each time

    const promise = j.run();

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(3);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(4);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.retries).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// waitForCompletion — post-completion + sequential reuse
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — waitForCompletion edge cases", () => {
  it("resolves immediately when called after the run already finished", async () => {
    const j = job("t", noop).everyMinute();
    await j.run();
    expect(j.isRunning).toBe(false);
    await expect(j.waitForCompletion()).resolves.toBeUndefined();
  });

  it("a fresh waiter on a second run is independent of the first", async () => {
    const j = job("t", async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    }).everyMinute();

    // First run + waiter.
    const run1 = j.run();
    await vi.advanceTimersByTimeAsync(1);
    const wait1 = j.waitForCompletion();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([run1, wait1]);

    // Second run + new waiter — must not have been resolved early by run1.
    const run2 = j.run();
    await vi.advanceTimersByTimeAsync(1);
    let resolved = false;
    const wait2 = j.waitForCompletion().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([run2, wait2]);
    expect(resolved).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run() — overlap guard via _isRunning during in-flight run
// ─────────────────────────────────────────────────────────────────────────────

describe("Job — concurrent run() while in flight", () => {
  it("reports isRunning=true mid-flight and false once settled", async () => {
    let observedDuringRun: boolean | null = null;
    const j = job(
      "t",
      async self => {
        observedDuringRun = self.isRunning;
        await new Promise(resolve => setTimeout(resolve, 20));
      },
    ).everyMinute();

    const promise = j.run();
    await vi.advanceTimersByTimeAsync(1);
    expect(j.isRunning).toBe(true);

    await vi.advanceTimersByTimeAsync(20);
    await promise;

    expect(observedDuringRun).toBe(true);
    expect(j.isRunning).toBe(false);
  });
});
