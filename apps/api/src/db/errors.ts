import { TRPCError } from '@trpc/server';

/** Postgres unique violation. drizzle ≥ 0.44 wraps driver errors, so look at `cause` too. */
export const isUniqueViolation = (error: unknown): boolean => {
  const direct = (error as { code?: string }).code;
  const nested = (error as { cause?: { code?: string } }).cause?.code;
  return direct === '23505' || nested === '23505';
};

/** The index or constraint Postgres rejected. Empty string when the driver did not say. */
export const violatedConstraint = (error: unknown): string =>
  (error as { constraint?: string }).constraint ??
  (error as { cause?: { constraint?: string } }).cause?.constraint ??
  '';

/**
 * Builds a service's catch-clause handler: maps a unique violation to its message by constraint
 * name (never guesses), rethrows anything else. `conflictMessage` is a service's own map, e.g.
 * `menuConflictMessage` or `addonConflictMessage`.
 */
export const conflictHandler =
  (conflictMessage: (constraint: string) => string | null) =>
  (error: unknown): never => {
    const message = isUniqueViolation(error) ? conflictMessage(violatedConstraint(error)) : null;
    if (message) throw new TRPCError({ code: 'CONFLICT', message });
    throw error;
  };
