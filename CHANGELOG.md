# Changelog — @warlock.js/scheduler

All notable changes to `@warlock.js/scheduler` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.6.0

### Fixed

- Warn in development when jobs are registered but `start()` is never called — a one-shot deferred check logs `N job(s) registered but scheduler.start() was never called`, is suppressed once `start()` runs or in production (`NODE_ENV=production`), and is unref'd so it never holds the process open.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
