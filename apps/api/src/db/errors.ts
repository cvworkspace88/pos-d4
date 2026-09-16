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
