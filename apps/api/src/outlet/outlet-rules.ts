/** Codes are compared case-insensitively by storing them exactly one way. */
export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

/** One roster line: who, and as what. */
export type StaffEntry = { userId: string; roleId: string };

/** The one role that never goes on a roster: it is global (`users.role_id`), so a manager cannot hand it out. */
export const OWNER_ROLE = 'owner';

/** The top of the per-outlet roles: only a global role (owner) may assign, change or remove one. */
export const MANAGER_ROLE = 'manager';

/**
 * May an `outlet.staff_assign` holder touch a roster line holding `role` — give it, take it, or
 * change it? Owner (global) manages everyone; anyone else manages the locked base roles below
 * manager, their own included — a cashier granted staff_assign can place other cashiers. Custom
 * roles are the owner's to hand out: one may hold more than whoever assigns it (US-009).
 * ponytail: a named tier plus the editable flag. A subset rule replaces both if non-owners ever assign custom roles.
 */
export const canManageRole = (actorGlobal: boolean, role: { name: string; editable: boolean }): boolean =>
  actorGlobal || (!role.editable && role.name !== MANAGER_ROLE && role.name !== OWNER_ROLE);

/**
 * What `setStaff` has to write to turn `current` into `desired`. Set semantics keyed on the user:
 * a duplicate user in `desired` collapses to the last entry, order does not matter, and a changed
 * role is a remove followed by an add (the primary key is `(outlet, user)`, so the row is replaced).
 */
export const staffDiff = (
  current: StaffEntry[],
  desired: StaffEntry[],
): { add: StaffEntry[]; remove: string[] } => {
  const held = new Map(current.map((s) => [s.userId, s.roleId]));
  const wanted = new Map(desired.map((s) => [s.userId, s.roleId]));
  return {
    add: [...wanted]
      .filter(([userId, roleId]) => held.get(userId) !== roleId)
      .map(([userId, roleId]) => ({ userId, roleId })),
    remove: [...held].filter(([userId, roleId]) => wanted.get(userId) !== roleId).map(([userId]) => userId),
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
