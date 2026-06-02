import dayjs, { type Dayjs } from "dayjs";

/**
 * Parsed cron expression fields
 */
export type CronFields = {
  /** Minutes (0-59) */
  minutes: number[];
  /** Hours (0-23) */
  hours: number[];
  /** Days of month (1-31) */
  daysOfMonth: number[];
  /** Months (1-12) */
  months: number[];
  /** Days of week (0-6, Sunday = 0) */
  daysOfWeek: number[];
};

/**
 * Cron expression parser
 *
 * Supports standard 5-field cron expressions:
 * ```
 * ┌───────────── minute (0-59)
 * │ ┌───────────── hour (0-23)
 * │ │ ┌───────────── day of month (1-31)
 * │ │ │ ┌───────────── month (1-12)
 * │ │ │ │ ┌───────────── day of week (0-6, Sunday = 0)
 * │ │ │ │ │
 * * * * * *
 * ```
 *
 * Supports:
 * - `*` - any value
 * - `5` - specific value
 * - `1,3,5` - list of values
 * - `1-5` - range of values
 * - `*‍/5` - step values (every 5)
 * - `1-10/2` - range with step
 *
 * **Day-of-month / day-of-week semantics:** follows Vixie cron — when both
 * fields are restricted (neither is `*`), a date matches if it satisfies
 * EITHER constraint. When only one is restricted, the other is ignored.
 *
 * @example
 * ```typescript
 * const parser = new CronParser("0 9 * * 1-5"); // 9 AM weekdays
 * const nextRun = parser.nextRun();
 * ```
 */
export class CronParser {
  private readonly _fields: CronFields;
  private readonly _isDayOfMonthRestricted: boolean;
  private readonly _isDayOfWeekRestricted: boolean;

  /**
   * Creates a new CronParser instance
   *
   * @param expression - Standard 5-field cron expression
   * @throws Error if expression is invalid
   */
  public constructor(private readonly _expression: string) {
    const parts = _expression.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: "${_expression}". Expected 5 fields (minute hour day month weekday).`,
      );
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    this._isDayOfMonthRestricted = dayOfMonth.trim() !== "*";
    this._isDayOfWeekRestricted = dayOfWeek.trim() !== "*";

    this._fields = {
      minutes: this._parseField(minute, 0, 59),
      hours: this._parseField(hour, 0, 23),
      daysOfMonth: this._parseField(dayOfMonth, 1, 31),
      months: this._parseField(month, 1, 12),
      daysOfWeek: this._parseField(dayOfWeek, 0, 6),
    };

    this._assertSatisfiable();
  }

  /**
   * Get the parsed cron fields
   */
  public get fields(): Readonly<CronFields> {
    return this._fields;
  }

  /**
   * Get the original expression
   */
  public get expression(): string {
    return this._expression;
  }

  /**
   * Calculate the next run time from a given date
   *
   * @param from - Starting date (defaults to now)
   * @returns Next run time as Dayjs
   */
  public nextRun(from: Dayjs = dayjs()): Dayjs {
    let date = from.add(1, "minute").second(0).millisecond(0);

    // Defensive backstop only: impossible day-of-month / month combinations are
    // rejected eagerly in the constructor (see `_assertSatisfiable`), so a
    // satisfiable expression resolves within a single year. This bound just
    // guarantees the loop can never spin unbounded.
    const maxIterations = 366 * 24 * 60; // 1 year of minutes
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Check month
      if (!this._fields.months.includes(date.month() + 1)) {
        date = date.add(1, "month").date(1).hour(0).minute(0);
        continue;
      }

      // Day-of-month + day-of-week — Vixie OR semantics when both restricted.
      if (!this._dayMatches(date)) {
        date = date.add(1, "day").hour(0).minute(0);
        continue;
      }

      // Check hour
      if (!this._fields.hours.includes(date.hour())) {
        date = date.add(1, "hour").minute(0);
        continue;
      }

      // Check minute
      if (!this._fields.minutes.includes(date.minute())) {
        date = date.add(1, "minute");
        continue;
      }

      // All fields match!
      return date;
    }

    throw new Error(
      `Could not find next run time for cron expression: ${this._expression}`,
    );
  }

  /**
   * Check if a given date matches the cron expression
   *
   * @param date - Date to check
   * @returns true if the date matches
   */
  public matches(date: Dayjs): boolean {
    return (
      this._fields.minutes.includes(date.minute()) &&
      this._fields.hours.includes(date.hour()) &&
      this._fields.months.includes(date.month() + 1) &&
      this._dayMatches(date)
    );
  }

  /**
   * Day-of-month / day-of-week match using Vixie cron semantics.
   *
   * When both fields are restricted (neither was `*`), a date matches if
   * EITHER the day-of-month or the day-of-week matches. When only one is
   * restricted, only that one needs to match (the other is the full set
   * by construction, so AND degenerates to the restricted one).
   */
  private _dayMatches(date: Dayjs): boolean {
    const dayOfMonthMatches = this._fields.daysOfMonth.includes(date.date());
    const dayOfWeekMatches = this._fields.daysOfWeek.includes(date.day());

    if (this._isDayOfMonthRestricted && this._isDayOfWeekRestricted) {
      return dayOfMonthMatches || dayOfWeekMatches;
    }

    return dayOfMonthMatches && dayOfWeekMatches;
  }

  /**
   * Reject expressions whose day-of-month / month combination can never occur
   * (e.g. `0 0 30 2 *` — February never has a 30th).
   *
   * Without this guard, `nextRun()` would scan its full ~1-year iteration
   * budget (527,040 passes) before throwing — seconds of synchronous CPU that
   * stalls the event loop. Catching it here makes the failure eager and cheap,
   * consistent with every other validation throw in the constructor.
   *
   * Only applies when the day-of-week field is unrestricted (`*`). Under Vixie
   * OR semantics, a restricted day-of-week keeps the schedule satisfiable via
   * the weekday path even when no listed day-of-month fits any listed month, so
   * such expressions must NOT be rejected.
   */
  private _assertSatisfiable(): void {
    if (this._isDayOfWeekRestricted) {
      return;
    }

    const smallestDay = this._fields.daysOfMonth[0];

    const reachable = this._fields.months.some(
      (month) => smallestDay <= this._maxDaysInMonth(month),
    );

    if (!reachable) {
      throw new Error(
        `Impossible cron expression: "${this._expression}". No day-of-month in [${this._fields.daysOfMonth.join(", ")}] ever occurs in month(s) [${this._fields.months.join(", ")}].`,
      );
    }
  }

  /**
   * Largest possible day number for a 1-based month, taking leap years into
   * account so February resolves to 29 (a date that does occur, just not every
   * year). Used by satisfiability checking, never for matching a concrete date.
   */
  private _maxDaysInMonth(month: number): number {
    if (month === 2) {
      return 29;
    }

    const thirtyDayMonths = [4, 6, 9, 11];

    if (thirtyDayMonths.includes(month)) {
      return 30;
    }

    return 31;
  }

  /**
   * Parse a single cron field
   *
   * @param field - Field value (e.g., "*", "5", "1-5", "*‍/2", "1,3,5")
   * @param min - Minimum allowed value
   * @param max - Maximum allowed value
   * @returns Array of matching values
   */
  private _parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>();

    // Handle lists (e.g., "1,3,5")
    const parts = field.split(",");

    for (const part of parts) {
      // Handle step values (e.g., "*‍/5" or "1-10/2")
      const [range, stepStr] = part.split("/");
      const step = stepStr ? parseInt(stepStr, 10) : 1;

      if (isNaN(step) || step < 1) {
        throw new Error(`Invalid step value in cron field: "${field}"`);
      }

      let rangeStart: number;
      let rangeEnd: number;

      if (range === "*") {
        // Wildcard - all values
        rangeStart = min;
        rangeEnd = max;
      } else if (range.includes("-")) {
        // Range (e.g., "1-5")
        const [startStr, endStr] = range.split("-");
        rangeStart = parseInt(startStr, 10);
        rangeEnd = parseInt(endStr, 10);

        if (isNaN(rangeStart) || isNaN(rangeEnd)) {
          throw new Error(`Invalid range in cron field: "${field}"`);
        }

        if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
          throw new Error(
            `Range out of bounds in cron field: "${field}" (valid: ${min}-${max})`,
          );
        }
      } else {
        // Single value
        const value = parseInt(range, 10);

        if (isNaN(value)) {
          throw new Error(`Invalid value in cron field: "${field}"`);
        }

        if (value < min || value > max) {
          throw new Error(
            `Value out of bounds in cron field: "${field}" (valid: ${min}-${max})`,
          );
        }

        rangeStart = value;
        rangeEnd = value;
      }

      // Add values with step
      for (let i = rangeStart; i <= rangeEnd; i += step) {
        values.add(i);
      }
    }

    return Array.from(values).sort((a, b) => a - b);
  }
}

/**
 * Parse a cron expression string
 *
 * @param expression - Cron expression (5 fields)
 * @returns CronParser instance
 */
export function parseCron(expression: string): CronParser {
  return new CronParser(expression);
}
