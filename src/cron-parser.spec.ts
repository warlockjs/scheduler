import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { beforeAll, describe, expect, it } from "vitest";
import { CronParser, parseCron } from "./cron-parser";

beforeAll(() => {
  dayjs.extend(utc);
  dayjs.extend(timezone);
});

const at = (iso: string) => dayjs(iso).utc();

// ─────────────────────────────────────────────────────────────────────────────
// Field parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — field parsing", () => {
  it("parses wildcard '*' as full range", () => {
    const parser = new CronParser("* * * * *");
    expect(parser.fields.minutes).toEqual(
      Array.from({ length: 60 }, (_, i) => i),
    );
    expect(parser.fields.hours).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    );
    expect(parser.fields.daysOfMonth).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
    expect(parser.fields.months).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(parser.fields.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("parses single fixed value", () => {
    const parser = new CronParser("5 10 15 6 3");
    expect(parser.fields.minutes).toEqual([5]);
    expect(parser.fields.hours).toEqual([10]);
    expect(parser.fields.daysOfMonth).toEqual([15]);
    expect(parser.fields.months).toEqual([6]);
    expect(parser.fields.daysOfWeek).toEqual([3]);
  });

  it("parses comma list", () => {
    expect(new CronParser("1,3,5 * * * *").fields.minutes).toEqual([1, 3, 5]);
  });

  it("parses range", () => {
    expect(new CronParser("0 9-17 * * *").fields.hours).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  it("parses '*‍/N' step on wildcard", () => {
    expect(new CronParser("*/5 * * * *").fields.minutes).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
  });

  it("parses range with step", () => {
    expect(new CronParser("0 1-10/2 * * *").fields.hours).toEqual([
      1, 3, 5, 7, 9,
    ]);
  });

  it("parses combined business-hours weekday expression", () => {
    const parser = new CronParser("0,30 9-17 * * 1-5");
    expect(parser.fields.minutes).toEqual([0, 30]);
    expect(parser.fields.hours).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(parser.fields.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("deduplicates overlapping list entries", () => {
    expect(new CronParser("1,1,2,2 * * * *").fields.minutes).toEqual([1, 2]);
  });

  it("trims excess whitespace between fields", () => {
    expect(() => new CronParser("  0    9    *    *    *  ")).not.toThrow();
  });

  it("treats a step on a single value as just that value ('5/2' → [5])", () => {
    // A step only fans out across a span; a bare value has span length 1,
    // so the inner `for (i = 5; i <= 5; i += 2)` yields a single entry.
    expect(new CronParser("5/2 * * * *").fields.minutes).toEqual([5]);
  });

  it("ignores an empty step suffix ('5/' → step defaults to 1 → [5])", () => {
    // "5/".split("/") → ["5", ""]; the empty stepStr is falsy so step = 1.
    expect(new CronParser("5/ * * * *").fields.minutes).toEqual([5]);
  });

  it("yields only the start when the step exceeds the range span ('1-3/10' → [1])", () => {
    expect(new CronParser("1-3/10 * * * *").fields.minutes).toEqual([1]);
  });

  it("accepts a degenerate range where start equals end ('5-5' → [5])", () => {
    expect(new CronParser("5-5 * * * *").fields.minutes).toEqual([5]);
  });

  it("merges multiple comma groups, one stepped, one plain", () => {
    // "1-4/2" → [1, 3]; "10-12" → [10, 11, 12]; union sorted.
    expect(new CronParser("1-4/2,10-12 * * * *").fields.minutes).toEqual([
      1, 3, 10, 11, 12,
    ]);
  });

  it("merges singletons with a stepped range in one field", () => {
    // "0", "15", "30-40/5" → [0, 15, 30, 35, 40].
    expect(new CronParser("0,15,30-40/5 * * * *").fields.minutes).toEqual([
      0, 15, 30, 35, 40,
    ]);
  });

  it("keeps the result sorted ascending regardless of source order", () => {
    expect(new CronParser("50,5,30 * * * *").fields.minutes).toEqual([
      5, 30, 50,
    ]);
  });

  it("parses the boundary values 0 and 59 for minutes", () => {
    const fields = new CronParser("0,59 * * * *").fields;
    expect(fields.minutes).toEqual([0, 59]);
  });

  it("parses day-of-week 0 and 6 (Sunday and Saturday)", () => {
    expect(new CronParser("0 0 * * 0,6").fields.daysOfWeek).toEqual([0, 6]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — validation errors", () => {
  it("rejects too few fields", () => {
    expect(() => new CronParser("* * * *")).toThrow(/Expected 5 fields/);
  });

  it("rejects too many fields", () => {
    expect(() => new CronParser("* * * * * *")).toThrow(/Expected 5 fields/);
  });

  it("rejects empty expression", () => {
    expect(() => new CronParser("")).toThrow(/Expected 5 fields/);
  });

  it("rejects non-numeric value", () => {
    expect(() => new CronParser("abc * * * *")).toThrow(/Invalid value/);
  });

  it("rejects minute out of range (60)", () => {
    expect(() => new CronParser("60 * * * *")).toThrow(/Value out of bounds/);
  });

  it("rejects hour out of range (24)", () => {
    expect(() => new CronParser("0 24 * * *")).toThrow(/Value out of bounds/);
  });

  it("rejects day-of-month 0", () => {
    expect(() => new CronParser("0 0 0 * *")).toThrow(/Value out of bounds/);
  });

  it("rejects day-of-month 32", () => {
    expect(() => new CronParser("0 0 32 * *")).toThrow(/Value out of bounds/);
  });

  it("rejects month 0 and 13", () => {
    expect(() => new CronParser("0 0 1 0 *")).toThrow(/Value out of bounds/);
    expect(() => new CronParser("0 0 1 13 *")).toThrow(/Value out of bounds/);
  });

  it("rejects day-of-week 7 (Sunday is 0 only)", () => {
    expect(() => new CronParser("0 0 * * 7")).toThrow(/Value out of bounds/);
  });

  it("rejects inverted range", () => {
    expect(() => new CronParser("5-1 * * * *")).toThrow(/Range out of bounds/);
  });

  it("rejects step of 0", () => {
    expect(() => new CronParser("*/0 * * * *")).toThrow(/Invalid step/);
  });

  it("rejects non-numeric step", () => {
    expect(() => new CronParser("*/x * * * *")).toThrow(/Invalid step/);
  });

  it("rejects range with non-numeric bound", () => {
    expect(() => new CronParser("1-x * * * *")).toThrow(/Invalid range/);
  });

  it("rejects a negative step value", () => {
    // "*/-2" → step = -2, caught by the `step < 1` guard.
    expect(() => new CronParser("*/-2 * * * *")).toThrow(/Invalid step/);
  });

  it("rejects an empty entry inside a comma list ('1,,3')", () => {
    // The empty middle part parses to NaN → "Invalid value".
    expect(() => new CronParser("1,,3 * * * *")).toThrow(/Invalid value/);
  });

  it("rejects an all-whitespace expression as wrong field count", () => {
    expect(() => new CronParser("     ")).toThrow(/Expected 5 fields/);
  });

  it("rejects a range whose start is below the field minimum", () => {
    // day-of-month min is 1, so "0-5" is out of bounds.
    expect(() => new CronParser("0 0 0-5 * *")).toThrow(/Range out of bounds/);
  });

  it("rejects a range whose end exceeds the field maximum", () => {
    // hours max is 23, so "20-25" is out of bounds.
    expect(() => new CronParser("0 20-25 * * *")).toThrow(/Range out of bounds/);
  });

  it("reports the field's valid bounds in the out-of-bounds message", () => {
    expect(() => new CronParser("99 * * * *")).toThrow(/valid: 0-59/);
    expect(() => new CronParser("0 0 99 * *")).toThrow(/valid: 1-31/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextRun
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — nextRun", () => {
  it("finds next slot for every-5-minutes", () => {
    const parser = new CronParser("*/5 * * * *");
    const next = parser.nextRun(at("2026-05-11T10:02:30Z"));
    expect(next.format("YYYY-MM-DD HH:mm")).toBe("2026-05-11 10:05");
  });

  it("returns next hour boundary for '0 * * * *'", () => {
    const parser = new CronParser("0 * * * *");
    expect(
      parser.nextRun(at("2026-05-11T10:30:00Z")).format("HH:mm"),
    ).toBe("11:00");
  });

  it("fires today at 09:00 when called before 09:00", () => {
    const parser = new CronParser("0 9 * * *");
    expect(
      parser
        .nextRun(at("2026-05-11T07:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-05-11 09:00");
  });

  it("rolls to next day when called after 09:00", () => {
    const parser = new CronParser("0 9 * * *");
    expect(
      parser
        .nextRun(at("2026-05-11T10:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-05-12 09:00");
  });

  it("skips weekends for weekday-only schedules", () => {
    // Sat 2026-05-09 → first weekday is Mon 2026-05-11
    const parser = new CronParser("0 9 * * 1-5");
    expect(
      parser
        .nextRun(at("2026-05-09T10:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-05-11 09:00");
  });

  it("monthly 1st rolls to next month when past", () => {
    const parser = new CronParser("0 0 1 * *");
    expect(
      parser
        .nextRun(at("2026-05-15T10:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-06-01 00:00");
  });

  it("yearly Jan 1 rolls over year", () => {
    const parser = new CronParser("0 0 1 1 *");
    expect(
      parser
        .nextRun(at("2026-05-15T10:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2027-01-01 00:00");
  });

  it("rolls midnight across year-end boundary", () => {
    const parser = new CronParser("0 0 * * *");
    expect(
      parser
        .nextRun(at("2026-12-31T23:30:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2027-01-01 00:00");
  });

  it("respects Feb 29 in leap years", () => {
    // 2028 is a leap year.
    const parser = new CronParser("0 0 * * *");
    expect(
      parser
        .nextRun(at("2028-02-28T01:00:00Z"))
        .format("YYYY-MM-DD"),
    ).toBe("2028-02-29");
  });

  it("skips months with fewer days for day-31 schedules", () => {
    const parser = new CronParser("0 0 31 * *");
    // April has 30 days — next 31st is May 31.
    expect(
      parser.nextRun(at("2026-04-15T00:00:00Z")).format("YYYY-MM-DD"),
    ).toBe("2026-05-31");
  });

  it("defaults `from` to now when omitted", () => {
    expect(parseCron("0 0 1 1 *").nextRun()).toBeDefined();
  });

  it("advances by exactly one minute granularity, never sub-minute", () => {
    // Even when `from` has seconds, the result is zeroed to the next minute.
    const parser = new CronParser("* * * * *");
    const next = parser.nextRun(at("2026-05-11T10:00:30Z"));
    expect(next.second()).toBe(0);
    expect(next.millisecond()).toBe(0);
    expect(next.format("HH:mm")).toBe("10:01");
  });

  it("returns a strictly future time (start is exclusive via +1 minute)", () => {
    // Called exactly at a matching slot — must roll forward, not return `from`.
    const parser = new CronParser("0 9 * * *");
    const from = at("2026-05-11T09:00:00Z");
    expect(parser.nextRun(from).isAfter(from)).toBe(true);
    expect(parser.nextRun(from).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-05-12 09:00",
    );
  });

  it("evaluates fields in the timezone of the `from` instant", () => {
    // `from` is 09:00 in Tokyo (UTC+9). The parser reads hour()/minute() in
    // that zone, so "0 9 * * *" matches 09:00 Tokyo — and since `from` is
    // already at 09:00 (exclusive), it rolls to the next day, 09:00 Tokyo.
    const parser = new CronParser("0 9 * * *");
    const fromTokyo = dayjs("2026-05-11T00:00:00Z").tz("Asia/Tokyo");
    const next = parser.nextRun(fromTokyo);
    expect(next.format("YYYY-MM-DD HH:mm")).toBe("2026-05-12 09:00");
    expect(next.utcOffset()).toBe(540); // +09:00 preserved
  });

  it("finds the every-5-minutes slot relative to a timezoned `from`", () => {
    const parser = new CronParser("*/5 * * * *");
    const fromNy = dayjs("2026-05-11T13:02:30Z").tz("America/New_York"); // 09:02:30 EDT
    const next = parser.nextRun(fromNy);
    expect(next.format("HH:mm")).toBe("09:05");
    expect(next.utcOffset()).toBe(-240); // EDT
  });

  // A valid-but-impossible expression (e.g. Feb 30) is now rejected eagerly at
  // construction by `_assertSatisfiable`, so it never reaches the ~527,040-pass
  // forward scan that used to burn ~5.7s of synchronous CPU. The throw is fast
  // and happens at `new CronParser(...)`, not at `nextRun()`.
  it("rejects an impossible day-of-month / month combination eagerly (Feb 30)", () => {
    expect(() => new CronParser("0 0 30 2 *")).toThrow(
      /Impossible cron expression/,
    );
  });

  it("rejects the impossible combo fast — no giant forward scan", () => {
    const start = performance.now();

    expect(() => new CronParser("0 0 30 2 *")).toThrow();

    const elapsed = performance.now() - start;

    // The old scan cost seconds; eager rejection is sub-millisecond. A generous
    // 200ms ceiling proves we are not walking the full iteration budget while
    // staying robust on slow CI.
    expect(elapsed).toBeLessThan(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stepped nextRun
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — stepped schedules", () => {
  it("every-2-hours fires on even hours only", () => {
    const parser = new CronParser("0 */2 * * *");
    // From 09:30 → next even hour at :00 is 10:00.
    expect(
      parser.nextRun(at("2026-05-11T09:30:00Z")).format("HH:mm"),
    ).toBe("10:00");
  });

  it("every-15-minutes lands on the quarter-hour grid", () => {
    const parser = new CronParser("*/15 * * * *");
    expect(
      parser.nextRun(at("2026-05-11T10:07:00Z")).format("HH:mm"),
    ).toBe("10:15");
    expect(
      parser.nextRun(at("2026-05-11T10:46:00Z")).format("HH:mm"),
    ).toBe("11:00");
  });

  it("range-with-step weekday business window honors both bounds", () => {
    // "0 9-17/4 * * 1-5" → hours 9, 13, 17 on weekdays.
    const parser = new CronParser("0 9-17/4 * * 1-5");
    expect(parser.fields.hours).toEqual([9, 13, 17]);
    // From Mon 10:00 → next slot is 13:00 same day.
    expect(
      parser.nextRun(at("2026-05-11T10:00:00Z")).format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-05-11 13:00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vixie cron OR semantics (regression for the AND-bug)
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — DOM/DOW OR semantics", () => {
  it("'1 OR Monday': fires on Monday even when not the 1st", () => {
    // From Wed 2026-05-13 → next Mon is 2026-05-18 (NOT June 1)
    const parser = new CronParser("0 0 1 * 1");
    expect(
      parser.nextRun(at("2026-05-13T00:00:00Z")).format("YYYY-MM-DD"),
    ).toBe("2026-05-18");
  });

  it("'1 OR Monday': fires on the 1st even when not Monday", () => {
    // From Tue 2026-06-30 → next 1st is Wed 2026-07-01, next Mon is 2026-07-06
    const parser = new CronParser("0 0 1 * 1");
    expect(
      parser.nextRun(at("2026-06-30T00:01:00Z")).format("YYYY-MM-DD"),
    ).toBe("2026-07-01");
  });

  it("only DOM restricted: AND degenerates to DOM-only", () => {
    const parser = new CronParser("0 0 15 * *");
    expect(
      parser.nextRun(at("2026-05-20T00:00:00Z")).format("YYYY-MM-DD"),
    ).toBe("2026-06-15");
  });

  it("only DOW restricted: AND degenerates to DOW-only", () => {
    // Wed 2026-05-13 → next Mon = 2026-05-18
    const parser = new CronParser("0 0 * * 1");
    expect(
      parser.nextRun(at("2026-05-13T00:00:00Z")).format("YYYY-MM-DD"),
    ).toBe("2026-05-18");
  });

  it("both * (no day restriction): every day", () => {
    const parser = new CronParser("0 12 * * *");
    expect(
      parser
        .nextRun(at("2026-05-11T13:00:00Z"))
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-05-12 12:00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matches()
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — matches", () => {
  it("matches at the exact slot", () => {
    expect(
      new CronParser("30 14 * * *").matches(at("2026-05-11T14:30:00Z")),
    ).toBe(true);
  });

  it("rejects neighbouring minute", () => {
    expect(
      new CronParser("30 14 * * *").matches(at("2026-05-11T14:31:00Z")),
    ).toBe(false);
  });

  it("uses OR semantics for DOM/DOW", () => {
    const parser = new CronParser("0 0 1 * 1");
    expect(parser.matches(at("2026-05-18T00:00:00Z"))).toBe(true); // Mon
    expect(parser.matches(at("2026-07-01T00:00:00Z"))).toBe(true); // 1st (Wed)
    expect(parser.matches(at("2026-05-13T00:00:00Z"))).toBe(false); // Wed, not 1st
  });

  it("rejects wrong month", () => {
    const parser = new CronParser("0 0 1 6 *");
    expect(parser.matches(at("2026-05-01T00:00:00Z"))).toBe(false);
    expect(parser.matches(at("2026-06-01T00:00:00Z"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Getters & factory
// ─────────────────────────────────────────────────────────────────────────────

describe("CronParser — getters and factory", () => {
  it("expression getter returns the original string", () => {
    expect(new CronParser("0 9 * * 1-5").expression).toBe("0 9 * * 1-5");
  });

  it("parseCron() returns a CronParser instance", () => {
    const parser = parseCron("0 0 * * *");
    expect(parser).toBeInstanceOf(CronParser);
    expect(parser.expression).toBe("0 0 * * *");
  });

  it("fields getter exposes parsed numeric arrays", () => {
    const fields = new CronParser("0 9 * * *").fields;
    expect(fields.minutes).toEqual([0]);
    expect(fields.hours).toEqual([9]);
  });
});
