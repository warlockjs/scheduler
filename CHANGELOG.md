# Changelog — @warlock.js/scheduler

All notable changes to `@warlock.js/scheduler` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.26.1 - 2026-09-30

### Fixed

- Republish of 5.26.0 with no code changes. npm accepted `@warlock.js/ai@5.26.0` but held it in a staged state that never became visible (npm/cli#9889), so 5.26.0 cannot be installed together with the AI packages. Use 5.26.1; 5.26.0 is deprecated.

## 5.26.0 - 2026-09-30

### Changed

- Lockstep release; package APIs are unchanged.

## 5.25.0 - 2026-09-28

### Changed

- `scheduler.start()` is now a no-op, logging `scheduler: not started (role: ...)`, on a process that doesn't serve the `worker` role (`WARLOCK_ROLES`) — so an app calling it in `main.ts` doesn't run its jobs on every `web`/`api` node. The "jobs registered but `start()` never called" development warning no longer fires on such a process. With no `--role` passed, every role is on and nothing changes.

## 5.24.0 - 2026-09-27

### Changed

- Lockstep release; package APIs are unchanged.

## 5.23.2 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.1 - 2026-09-26

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.23.0 - 2026-09-25

### Added

- `scheduler.around((job, run) => …)` wraps every job callback execution, each retry attempt included, so jobs can run inside a context such as `AsyncLocalStorage`. Multiple hooks compose with the first registered outermost; the call returns an unsubscribe function. A hook that never calls `run` skips the execution and emits `job:skip` (`JobResult.skipped` / `skipReason`); a hook that throws follows the normal retry/error path.

## 5.22.1 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.0 - 2026-09-25

### Fixed

- Cron and time parsing handle absent fields explicitly under strict TypeScript checks.

## 5.21.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.
## 5.20.0 - 2026-09-24

### Added

- `job.onOneServer({ lockTtl?, key? })` — run each tick on exactly one server. Every server races for a create-only, TTL-bounded cache claim keyed `scheduler.<key ?? name>.<scheduledTickEpochMs>`. The claim is never released, so exactly one server runs each tick even if another server's timer fires late. Losers skip the tick and emit `job:skip`. Requires a shared cache driver (redis/pg) and a job name or `key`. `@warlock.js/cache` is an optional peer dependency. Default claim TTL is `min(interval, 1h)` with a 60s floor (1h for cron jobs).

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

- Documented: the README, CHANGELOG, and `overview` skill now describe the
  already-shipped `package.json` `"warlock": { "environment": "server" }`
  marker — `@warlock.js/scheduler`'s entire runtime surface is server-only.
  The marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

## 5.1.0

No changes to `@warlock.js/scheduler`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/scheduler`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/scheduler`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.6.0

### Fixed

- Warn in development when jobs are registered but `start()` is never called — a one-shot deferred check logs `N job(s) registered but scheduler.start() was never called`, is suppressed once `start()` runs or in production (`NODE_ENV=production`), and is unref'd so it never holds the process open.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
