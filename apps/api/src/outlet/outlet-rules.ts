/** Codes are compared case-insensitively by storing them exactly one way. */
export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

/**
 * What `setStaff` has to write to turn `current` into `desired`. Set semantics: a duplicate in
 * `desired` collapses, and order does not matter on either side.
 */
export const staffDiff = (
  current: string[],
  desired: string[],
): { add: string[]; remove: string[] } => {
  const held = new Set(current);
  const wanted = new Set(desired);
  return {
    add: [...wanted].filter((id) => !held.has(id)),
    remove: [...held].filter((id) => !wanted.has(id)),
  };
};

/**
 * Which field a unique violation was about, read off the index Postgres names. Null means the
 * violation came from somewhere else and the caller must rethrow rather than guess.
 */
export const conflictField = (constraint: string): 'name' | 'code' | null => {
  if (constraint === 'outlets_name_active_idx') return 'name';
  if (constraint === 'outlets_code_active_idx') return 'code';
  return null;
};
