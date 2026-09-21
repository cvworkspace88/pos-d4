# Per-user permission overrides

**Date:** 2026-09-15
**Status:** Approved, not implemented

## Problem

Permissions are role-only. `users.roleId` points at a role, `role_permissions` lists what that
role holds, and `RbacService.permissionsOf` is one join from user to permission names. A user who
needs one extra permission — or must lose one — has no home for it: the only lever is moving them
to a different role, which changes everything else too.

## Goal

A role stays the default a new user inherits. On top of it, a user may carry explicit per-user
overrides: extra permissions granted, or role-given permissions taken back.

## Model: overrides, not snapshots

Effective set = `role permissions + grants - revokes`. A user with no override rows behaves exactly
as they do today.

The rejected alternative was copying the role's permissions into per-user rows at creation, leaving
the role a label. It loses on this codebase specifically: `drizzle/seed/seed-rbac.ts` is the source
of truth for the permission list and re-runs idempotently, and the list is still growing — the
`sales.*`, `inventory.*` and `order.*` domains are seeded but unbuilt. Under snapshots every new
permission needs a per-user backfill; under overrides one line in `PERMISSIONS` reaches everyone on
the role.

## Scope

In scope: schema, migration, effective-permission resolution, unit tests.

Out of scope: an admin tRPC router, admin UI, and any write path. Until one exists, override rows
are written by hand (SQL or a seed). The client-facing shape does not change — `auth.me` keeps
returning a flat `permissions: string[]`, now the effective set.

## Schema

New table in `apps/api/src/db/schema.ts`, placed after `rolePermissions`:

```ts
export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    // 'grant' adds what the role lacks, 'revoke' takes back what it gives. No row = inherit.
    effect: text('effect').$type<'grant' | 'revoke'>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionId] }),
    check('user_permissions_effect', sql`${table.effect} IN ('grant', 'revoke')`),
  ],
);

export type UserPermission = typeof userPermissions.$inferSelect;
```

Decisions:

- **Primary key `(user_id, permission_id)`** — one override row per permission per user, so a grant
  and a revoke for the same pair cannot coexist. Precedence is structural rather than a rule
  someone has to remember.
- **CHECK on `effect`** — this is an authorization table; a misspelled effect must fail at write
  time, not read back as neither grant nor revoke.
- **No `permission_id` index.** `role_permissions` carries one for reverse lookups ("who holds X").
  No such query exists against overrides yet. Add it when one does.
- **Cascade on both FKs.** Users are soft-deleted (`deletedAt`), so the user cascade rarely fires;
  the permission cascade matters, because `seedRbac` deletes permissions dropped from `PERMISSIONS`
  and their override rows must go with them, exactly as `role_permissions` rows do.

Migration: `pnpm --filter @repo/api db:generate` produces `drizzle/0002_*.sql`, applied with
`db:migrate`. The seed is unchanged.

## Resolution rule

New pure module `apps/api/src/auth/rbac-rules.ts`, following the existing `floor-rules.ts` /
`pin-policy.ts` / `refresh-window.ts` pattern — rules live in a pure function so they can be tested
without a database:

```ts
export type PermissionRow = { name: string; source: 'role' | 'grant' | 'revoke' };

/** Revoke beats the role. A grant for what the role already gives is a no-op. Sorted, deduped. */
export const effectivePermissions = (rows: PermissionRow[]): string[] => {
  const held = new Set(rows.filter((r) => r.source !== 'revoke').map((r) => r.name));
  for (const row of rows) if (row.source === 'revoke') held.delete(row.name);
  return [...held].sort();
};
```

`source` is `'role'` plus the two `effect` values verbatim, so SQL projects `effect` straight into
the field with no mapping. Output is sorted for deterministic tests and readable debugging.

## Service

`RbacService.permissionsOf` becomes a `unionAll` of two selects, both keyed on the same `userId`:

- the existing role join (`users` → `role_permissions` → `permissions`), tagged `'role'`
- an overrides join (`user_permissions` → `permissions`), tagged with `user_permissions.effect`

The combined rows go through `effectivePermissions`. Still one database round trip, which matters
because `require()` runs on every gated mutation.

`RbacService.require` is unchanged — it calls `permissionsOf` and checks membership.

## Blast radius

Nothing downstream changes. `permissionsOf` keeps returning `string[]`; `auth.me`'s
`userOutput.extend({ permissions: z.array(z.string()) })` is untouched, so the generated
`packages/api-contract` needs no regeneration, and `apps/desktop` and `apps/mobile` keep reading a
flat array. With zero override rows the effective set equals today's role set, so the migration is
safe to land before any writer exists.

## Testing

New `apps/api/src/auth/rbac-rules.test.ts` (node:test + `node:assert/strict`), added to the explicit
file list in the api package's `test` script:

- role permissions only, no overrides, returns the role set
- a grant adds a permission the role does not hold
- a revoke removes a permission the role does hold
- a revoke for a permission the role never held is inert
- a grant duplicating a role permission produces no duplicate entry
- no role and no overrides returns `[]`

`RbacService.permissionsOf` itself is not unit-tested: it is a query, and this repo has no database
test harness. The rule it applies is what the tests cover.

## Deferred

- Admin router (`users.list`, `users.get`, `users.setOverrides`) behind a new `users.manage`
  permission, and the desktop UI for it (tri-state per permission: inherit / grant / revoke).
- Lockout guard. A revoke on the owner's `settings.manage` would lock the deployment out of its own
  settings. Validation belongs at the write boundary, and there is no write boundary yet — add it
  with `users.setOverrides`.
