---
name: schedule-fluently
description: 'Build a job schedule via `every*` / `daily` / `weekly` / `monthly` / `at` / `on` / `beginOf` / `endOf`. Triggers: `.everyMinutes`, `.daily`, `.weekly`, `.monthly`, `.at`, `.on`, `.every`, `.beginOf`, `.endOf`, `.twiceDaily`, `scheduler.newJob`; "run every 5 minutes", "daily at 3am", "monday standup", "first of every month", "last day of month"; typical import `import { job, scheduler } from "@warlock.js/scheduler"`. Skip: cron — `@warlock.js/scheduler/schedule-with-cron/SKILL.md`; timezone — `@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`; retry — `@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`; competing `node-cron`, `node-schedule`, `agenda`; native `setInterval`.'
---

# Fluent scheduling API

Chainable methods on a `Job` instance. Each method returns `this` for chaining; each call recomputes `job.nextRun` on the spot.

## Preset intervals

| Method               | Equivalent of            | Notes                          |
| -------------------- | ------------------------ | ------------------------------ |
| `.everySecond()`     | `.every(1, "second")`    | High frequency — use sparingly |
| `.everySeconds(N)`   | `.every(N, "second")`    |                                |
| `.everyMinute()`     | `.every(1, "minute")`    |                                |
| `.everyMinutes(N)`   | `.every(N, "minute")`    |                                |
| `.everyHour()`       | `.every(1, "hour")`      |                                |
| `.everyHours(N)`     | `.every(N, "hour")`      |                                |
| `.everyDay()`        | `.every(1, "day")`       | Same as `.daily()`             |
| `.daily()`           | `.every(1, "day")`       |                                |
| `.twiceDaily()`      | `.every(12, "hour")`     | Every 12 hours                 |
| `.everyWeek()`       | `.every(1, "week")`      | Same as `.weekly()`            |
| `.weekly()`          | `.every(1, "week")`      |                                |
| `.everyMonth()`      | `.every(1, "month")`     | Same as `.monthly()`           |
| `.monthly()`         | `.every(1, "month")`     |                                |
| `.everyYear()`       | `.every(1, "year")`      | Same as `.yearly()`            |
| `.yearly()`          | `.every(1, "year")`      |                                |
| `.always()`          | `.every(1, "minute")`    | Continuous "tick" jobs         |

## Custom intervals — `.every(value, unit)`

```ts
job("t", task).every(5, "minute");
job("t", task).every(2, "hour");
job("t", task).every(3, "day");
```

Units: `"second" | "minute" | "hour" | "day" | "week" | "month" | "year"`.

**Validation.** `every(value, unit)` throws at definition time if `value` is `0`, negative, `NaN`, or `Infinity`. This guards against the misconfigured-interval class of bugs that would otherwise spin the scheduler.

## Target a specific time — `.at("HH:mm" | "HH:mm:ss")`

```ts
job("nightly", fn).daily().at("03:00");
job("midday",  fn).daily().at("12:30:15");
```

**Validation.** `.at()` throws if the format is malformed (`"foo"`, `"9-30"`), or any component is out of range (hour > 23, minute > 59, second > 59).

## Target a specific day — `.on(day)`

Day-of-week (string) or day-of-month (number 1–31):

```ts
job("monday-standup", task).weekly().on("monday");
job("mid-month-sync", task).monthly().on(15);
job("end-of-month",   task).monthly().on(31);    // see beginOf/endOf for the right way
```

Valid day-of-week strings: `"sunday"`, `"monday"`, `"tuesday"`, `"wednesday"`, `"thursday"`, `"friday"`, `"saturday"`.

**Validation.** Numeric `on(N)` throws if `N < 1 || N > 31`.

**Gotcha.** `monthly().on(31)` clamps to the actual month length in dayjs — February runs are unpredictable. Use `endOf("month")` for "last day" semantics instead.

## Boundary shortcuts — `.beginOf(type)` / `.endOf(type)`

Both accept `"day" | "month" | "year"`.

| Method               | Fires at                                          |
| -------------------- | ------------------------------------------------- |
| `beginOf("day")`     | 00:00 every day                                   |
| `endOf("day")`       | 23:59 every day                                   |
| `beginOf("month")`   | 1st of every month at 00:00                       |
| `endOf("month")`     | Last day of every month at 23:59 (**dynamic**)    |
| `beginOf("year")`    | January 1 at 00:00 every year                     |
| `endOf("year")`      | December 31 at 23:59 every year                   |

**`endOf("month")` is dynamic** — recomputes per cycle, so a job defined in February (28 days) still fires on March 31, April 30, etc. Leap years pick Feb 29 correctly.

**`beginOf("year")` / `endOf("year")` lock the month** — always Jan 1 / Dec 31, never "1st/31st of whatever month the job was defined in."

## Cron is an alternative, not an addition

`.cron("…")` clears any prior interval/`at`/`on`/`beginOf`/`endOf` config — and vice versa. They're mutually exclusive. See [`@warlock.js/scheduler/schedule-with-cron/SKILL.md`](@warlock.js/scheduler/schedule-with-cron/SKILL.md).

## Chaining order doesn't matter (for the most part)

Every fluent method recomputes `nextRun` at the end. Putting `.at()` before `.daily()` produces the same schedule as putting `.daily()` before `.at()` — but for readability, the conventional order is **interval → day → time → timezone → execution options**:

```ts
job("good", fn)
  .weekly()              // interval
  .on("monday")          // day
  .at("09:00")           // time
  .inTimezone("UTC")     // timezone
  .preventOverlap()      // execution
  .retry(3, 1000);       // execution
```

## Inline registration — `scheduler.newJob()`

For one-liners, the scheduler exposes a `newJob()` shortcut that creates, registers, and returns the job in one call:

```ts
scheduler
  .newJob("cleanup", cleanupFn)
  .daily()
  .at("03:00");
```

To register several pre-built jobs at once, `scheduler.addJobs([...])` is the batch counterpart to `addJob` (both are chainable and preserve insertion order):

```ts
scheduler.addJobs([
  job("cleanup", cleanupFn).daily().at("03:00"),
  job("reports", sendReports).weekly().on("monday").at("09:00"),
]);
```

If the scheduler is already running, every job added via `addJob` / `addJobs` is prepared on the spot (its `nextRun` is computed) so it fires on the next tick.

## Reading state at runtime

```ts
const j = scheduler.getJob("nightly-cleanup");

j?.nextRun?.toISOString();   // next scheduled run (Dayjs)
j?.lastRun?.toISOString();   // last attempt — success OR failure
j?.isRunning;                // currently executing?
j?.intervals;                // { every?, day?, dayOfMonthMode?, month?, time? } (readonly)
j?.cronExpression;           // null if using fluent API
```

## See also

- [`@warlock.js/scheduler/schedule-with-cron/SKILL.md`](@warlock.js/scheduler/schedule-with-cron/SKILL.md) — when the fluent API isn't enough
- [`@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md`](@warlock.js/scheduler/configure-retry-and-overlap/SKILL.md) — `.retry()` and `.preventOverlap()` on the same job
- [`@warlock.js/scheduler/pin-schedule-timezone/SKILL.md`](@warlock.js/scheduler/pin-schedule-timezone/SKILL.md) — `.inTimezone()`
