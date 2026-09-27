/**
 * `WARLOCK_ROLES`, parsed for the scheduler's own use.
 *
 * The scheduler has no dependency on `@warlock.js/core` (see package.json),
 * so it cannot call `Application.hasRole`. Core's `parseRoles` already
 * validates the raw value at process boot — an unknown role or an explicit
 * empty list throws there — so this only needs to decide membership, not
 * re-validate.
 */
function parsedRoles(): string[] {
  const value = process.env.WARLOCK_ROLES;

  if (!value) return [];

  return value
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);
}

/**
 * Whether this process serves the `worker` role.
 *
 * `true` when `WARLOCK_ROLES` is unset, matching core's default of "every
 * role is on" for plain `start`, `dev`, and tests.
 */
export function hasWorkerRole(): boolean {
  const roles = parsedRoles();

  return roles.length === 0 || roles.includes("worker");
}

/**
 * The roles this process serves, formatted for a log line — `"all"` when
 * `WARLOCK_ROLES` is unset.
 */
export function rolesLabel(): string {
  const roles = parsedRoles();

  return roles.length === 0 ? "all" : roles.join(",");
}
