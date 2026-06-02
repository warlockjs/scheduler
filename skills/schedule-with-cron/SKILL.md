---
name: schedule-with-cron
description: 'Write `.cron(''…'')` expressions — 5-field syntax, operators (`*` `,` `-` `/`), Vixie OR semantics for DOM / DOW, `parseCron()` preview utility. Triggers: `.cron`, `parseCron`, `CronParser`, `*/5 * * * *`, `0 9 * * 1-5`; "write a cron expression", "every weekday at 9am cron", "preview next cron run", "migrate crontab(5) entry"; typical import `import { parseCron } from "@warlock.js/scheduler"`. Skip: human-readable schedules — `@warlock.js/scheduler/schedule-fluently/SKILL.md`; timezone — `@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`; competing libs `node-cron`, `cron`, `croner`, `cronstrue`.'
---

# Cron expressions

The escape hatch when the fluent API can't express a schedule. Activating `.cron()` clears any prior fluent config — the two are mutually exclusive.

## 5-field syntax

```
┌───────────── minute        (0-59)
│ ┌───────────── hour          (0-23)
│ │ ┌───────────── day-of-month (1-31)
│ │ │ ┌───────────── month        (1-12)
│ │ │ │ ┌───────────── day-of-week  (0-6, Sunday = 0)
│ │ │ │ │
* * * * *
```

**Note:** Sunday is `0` only. Some cron dialects also accept `7` for Sunday — this parser does NOT.

## Operators

| Syntax    | Meaning                       | Example          |
| --------- | ----------------------------- | ---------------- |
| `*`       | Any value (full range)        | `* * * * *`      |
| `5`       | Single value                  | `30 14 * * *`    |
| `1,3,5`   | List                          | `0,30 * * * *`   |
| `1-5`     | Inclusive range               | `0 9-17 * * *`   |
| `*/N`     | Step over the wildcard        | `*/5 * * * *`    |
| `A-B/N`   | Step over a range             | `0 1-10/2 * * *` |

**Not supported (yet):** named tokens (`MON-FRI`, `JAN-DEC`), special strings (`@daily`, `@hourly`, `@reboot`), seconds field (6-field), Quartz modifiers (`L`, `W`, `#`).

## Day-of-month + day-of-week — Vixie OR semantics

When **both** `dayOfMonth` AND `dayOfWeek` are restricted (neither is `*`), the date matches if **either** constraint matches. When one is `*` and the other is restricted, only the restricted one matters.

```ts
// "1st of month OR any Monday" — fires on the 1st even if not a Monday,
// AND fires on any Monday even if not the 1st.
job("digest", sendDigest).cron("0 0 1 * 1");

// "15th of month" — DOW is *, so only DOM applies. Fires only on the 15th.
job("midmonth", task).cron("0 0 15 * *");

// "Every Monday" — DOM is *, so only DOW applies. Fires only on Mondays.
job("monday-only", task).cron("0 0 * * 1");
```

This matches Vixie cron (the de facto standard on Unix). Migrating an existing cron table from `crontab(5)` should "just work" semantically.

## Common recipes

```ts
// Every 5 minutes
.cron("*/5 * * * *")

// Top of every hour
.cron("0 * * * *")

// Every weekday at 9 AM
.cron("0 9 * * 1-5")

// 2:30 PM on the 15th of every month
.cron("30 14 15 * *")

// Every 2 hours, on the hour
.cron("0 */2 * * *")

// First day of each month at midnight
.cron("0 0 1 * *")
```

## Validation

`new CronParser(expr)` and `.cron(expr)` both throw at definition time on:

- Wrong field count (must be exactly 5)
- Non-numeric values, out-of-range values, inverted ranges (`5-1`)
- Step `<= 0`, non-numeric step
- Impossible day-of-month / month combinations — a date that can never occur, e.g. `0 0 30 2 *` (Feb 30) or `0 0 31 4 *` (April has 30 days). Rejected with an `Impossible cron expression` error.

```ts
new CronParser("0 0 30 2 *"); // throws: Impossible cron expression — Feb never has a 30th
new CronParser("0 0 31 4 *"); // throws: April has only 30 days
```

**Leap years and the OR escape hatch.** `0 0 29 2 *` (Feb 29) is **accepted** — it occurs in leap years. And when day-of-week is also restricted, Vixie OR semantics keep the schedule alive via the weekday path, so the combo is never rejected: `0 0 30 2 1` (Feb 30 OR any Monday) parses fine and fires on Mondays.

Throws are eager — bad expressions fail fast at construction, not at first tick.

## Standalone preview — `parseCron()`

The `CronParser` class is exported as a utility for ad-hoc next-run calculation, separate from any job:

```ts
import { parseCron } from "@warlock.js/scheduler";
import dayjs from "dayjs";

const parser = parseCron("0 9 * * 1-5");

parser.nextRun().toISOString();              // next weekday at 9 AM
parser.nextRun(dayjs("2026-12-31")).format(); // from a specific anchor

parser.matches(dayjs());                     // is "now" a fire moment?

parser.fields;                                // parsed numeric arrays
parser.expression;                            // original string
```

Impossible expressions are rejected eagerly at construction (see Validation), so `nextRun(from?)` always resolves a satisfiable expression within a year — its one-year scan bound is just a defensive backstop, never the path that catches a bad expression.

## Timezone interaction

If the job has `.inTimezone(tz)`, the cron parser receives a timezone-aware `dayjs` object — so `0 9 * * *` with `.inTimezone("Asia/Tokyo")` fires at 09:00 JST. See [`@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md).

## See also

- [`@warlock.js/scheduler/schedule-fluently/SKILL.md`](@warlock.js/scheduler/schedule-fluently/SKILL.md) — the higher-level alternative for human-readable schedules
- [`@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md) — pinning a cron schedule to a wall-clock timezone
