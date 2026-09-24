---
name: pin-schedule-timezone
description: 'Pin a job to a specific IANA timezone via `.inTimezone(zone)` so its wall-clock fire time stays correct regardless of server location / DST. Triggers: `.inTimezone`, `America/New_York`, `Europe/Berlin`, `Asia/Tokyo`, `NODE_ICU_DATA`; "schedule job in a timezone", "DST drift on non-UTC server", "multi-region fan-out scheduling", "fire at 9am ET regardless of server"; typical import `import { job, scheduler } from "@warlock.js/scheduler"`. Skip: fluent interval methods — `@warlock.js/scheduler/schedule-fluently/SKILL.md`; cron syntax — `@warlock.js/scheduler/schedule-with-cron/SKILL.md`; competing libs `dayjs-timezone`, `luxon`, `date-fns-tz`.'
---

# Per-job timezones

Every `Job` has its own timezone. The default is **UTC** — `.daily().at("09:00")` fires at 09:00 UTC, regardless of the server's locale or system timezone. Pin to wall-clock time with `.inTimezone(IANA string)`.

## Basic usage

```ts
job("morning-digest", sendDailyDigest)
  .daily()
  .at("08:00")
  .inTimezone("America/New_York");   // 8 AM ET, not 8 AM UTC
```

`.inTimezone()` is chainable — typically placed after the time/day methods.

## Why the default is UTC

A server runs wherever ops put it (Frankfurt, Virginia, GCP us-central1, …). System-local time is unpredictable; UTC is stable. The framework picks the stable default so that `daily().at("09:00")` without further config is reproducible across deployments. Pin to wall-clock time when business hours actually matter.

## Multi-region fan-out

Same logical task, three regions:

```ts
import { scheduler, job } from "@warlock.js/scheduler";

const regions = [
  { name: "us-east",   tz: "America/New_York" },
  { name: "eu-west",   tz: "Europe/Berlin" },
  { name: "asia",      tz: "Asia/Tokyo" },
];

for (const { name, tz } of regions) {
  scheduler.addJob(
    job(`morning-report-${name}`, () => sendReport(name))
      .daily()
      .at("09:00")
      .inTimezone(tz)
  );
}

scheduler.start();
```

Three separate `Job` instances, three separate `nextRun` calculations. Each fires once per day at its region's 09:00.

## DST is automatic

dayjs handles transitions correctly. A daily 09:00 job in `America/New_York` shifts between 13:00 UTC (EST winter) and 14:00 UTC (EDT summer) without intervention. The same job in a fixed-offset region (`Asia/Tokyo`, `Africa/Algiers`) stays at a constant UTC offset.

## Common IANA strings

| Region              | TZ string                   |
| ------------------- | --------------------------- |
| UTC                 | `UTC`                       |
| US Eastern          | `America/New_York`          |
| US Central          | `America/Chicago`           |
| US Mountain         | `America/Denver`            |
| US Pacific          | `America/Los_Angeles`       |
| UK / Ireland        | `Europe/London`             |
| Central Europe      | `Europe/Berlin`             |
| Eastern Europe      | `Europe/Kyiv`               |
| India               | `Asia/Kolkata`              |
| Japan               | `Asia/Tokyo`                |
| Australia (Sydney)  | `Australia/Sydney`          |
| Egypt               | `Africa/Cairo`              |

Full list: [IANA Time Zone Database](https://www.iana.org/time-zones).

## Interaction with `at()`, `on()`, cron

The timezone applies to every interpretation of "now" and every constraint:

```ts
job("monday-standup", task)
  .weekly()
  .on("monday")
  .at("09:00")
  .inTimezone("Europe/Berlin");
// "Monday in Berlin local time" + "09:00 Berlin local time"
// — automatically shifts CET ↔ CEST as DST changes.

job("nightly-cron", task)
  .cron("0 3 * * *")
  .inTimezone("Asia/Tokyo");
// "0 3 * * *" interpreted in Tokyo local time → 03:00 JST = 18:00 UTC.
```

## Validation

`.inTimezone()` stores the string as-is, then immediately recomputes `nextRun` — and that recompute calls dayjs with the zone. An invalid IANA string makes dayjs throw a `RangeError: Invalid time zone specified` **synchronously, at that point in the chain**:

```ts
// Throws right here — the .inTimezone() call recomputes nextRun, which
// hits dayjs().tz("Asia/Whatever") and raises RangeError immediately.
const j = job("t", task).daily().at("09:00").inTimezone("Asia/Whatever");
```

A valid zone computes `nextRun` on the spot (non-null after the chain). So a typo fails fast at definition time, not at the first tick — no special unit test needed to surface it.

## Server-side caveats

Node ships full ICU on most platforms, so all IANA zones work out of the box. If you're running a small-ICU build (alpine without full ICU, or old Node versions with `--icu=small`), only a limited set of zones is recognized. Set the `NODE_ICU_DATA` env var or use the `full-icu` package in that case.

## See also

- [`@warlock.js/scheduler/schedule-fluently/SKILL.md`](@warlock.js/scheduler/schedule-fluently/SKILL.md) — `at()`, `on()`, `daily()`, etc.
- [`@warlock.js/scheduler/schedule-with-cron/SKILL.md`](@warlock.js/scheduler/schedule-with-cron/SKILL.md) — cron schedules are timezone-aware too
- [`@warlock.js/scheduler/observe-scheduler/SKILL.md`](@warlock.js/scheduler/observe-scheduler/SKILL.md) — `job.nextRun.toISOString()` always renders in UTC; format with `.tz(zone)` to see local time
