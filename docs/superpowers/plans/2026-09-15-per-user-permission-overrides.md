# Per-User Permission Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user carry per-user permission grants and revokes on top of the permissions their role gives, so a role stays the default a new user inherits rather than the only lever.

**Architecture:** A new `user_permissions` table holds one override row per (user, permission) with an `effect` of `grant` or `revoke`. `RbacService.permissionsOf` reads the role join and the override join in a single `unionAll`, tags each row with its source, and feeds them to a pure `effectivePermissions` function that applies the rule: revoke beats role, no row means inherit. Nothing downstream changes — the method still returns `string[]`.

**Tech Stack:** NestJS 11, nestjs-trpc, Drizzle ORM 0.45 on node-postgres, drizzle-kit migrations, `node:test` + `node:assert/strict` for unit tests, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-15-per-user-permission-overrides-design.md`

## Global Constraints

- **Do not commit and do not create branches or worktrees.** Work on the current branch (`main`) and leave every change uncommitted for the user to review. This overrides the usual "commit at the end of each task" step.
- Unit tests use `node:test` and `node:assert/strict` only. No test framework, no mocks, no database in tests.
- Test files import source with an explicit `.ts` extension (`from './rbac-rules.ts'`); files under `src/` import each other **without** an extension (`from '../db/schema'`). Follow both conventions exactly — they are not interchangeable here.
- Every test file must be added by hand to the `test` script in `apps/api/package.json`; the script lists files explicitly and does not glob.
- Permission names are dotted strings (`domain.action`). Code checks names, never ids.
- The public shape of `auth.me` must not change. It stays `permissions: z.array(z.string())`, so `packages/api-contract` needs no regeneration and neither client changes.
- Run all commands from the repository root using pnpm filters, e.g. `pnpm --filter @repo/api test`.

---

### Task 1: The effective-permission rule

The rule that merges role permissions with per-user overrides, as a pure function with no database. This is the only piece with real logic, so it is the only piece with tests.

**Files:**
- Create: `apps/api/src/auth/rbac-rules.ts`
- Test: `apps/api/src/auth/rbac-rules.test.ts`
- Modify: `apps/api/package.json` (the `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PermissionRow = { name: string; source: 'role' | 'grant' | 'revoke' }`
  - `effectivePermissions(rows: PermissionRow[]): string[]` — sorted, deduplicated list of permission names the user effectively holds. Task 3 calls this.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/rbac-rules.test.ts` with exactly this content:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { type PermissionRow, effectivePermissions } from './rbac-rules.ts';

const role = (...names: string[]): PermissionRow[] =>
  names.map((name): PermissionRow => ({ name, source: 'role' }));
const grant = (name: string): PermissionRow => ({ name, source: 'grant' });
const revoke = (name: string): PermissionRow => ({ name, source: 'revoke' });

test('with no overrides the role set comes back as is', () => {
  assert.deepEqual(effectivePermissions(role('sales.view', 'sales.create')), [
    'sales.create',
    'sales.view',
  ]);
});

test('a grant adds a permission the role does not hold', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), grant('table.view')]), [
    'sales.view',
    'table.view',
  ]);
});

test('a revoke takes back a permission the role holds', () => {
  assert.deepEqual(
    effectivePermissions([...role('sales.view', 'sales.create'), revoke('sales.create')]),
    ['sales.view'],
  );
});

test('a revoke for a permission the role never held changes nothing', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), revoke('settings.manage')]), [
    'sales.view',
  ]);
});

test('a grant duplicating a role permission yields no duplicate', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), grant('sales.view')]), [
    'sales.view',
  ]);
});

test('a user with no role and no overrides holds nothing', () => {
  assert.deepEqual(effectivePermissions([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @repo/api exec node --test src/auth/rbac-rules.test.ts`

Expected: FAIL — the run errors out because `./rbac-rules.ts` does not exist (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/src/auth/rbac-rules.ts` with exactly this content:

```ts
/** A permission name plus where it came from: the user's role, or a per-user override row. */
export type PermissionRow = { name: string; source: 'role' | 'grant' | 'revoke' };

/**
 * The effective set: what the role gives, plus per-user grants, minus per-user revokes. A revoke
 * always beats the role, and a grant for something the role already gives is a no-op. Sorted, so
 * the output is stable to read in a log and to assert on in a test.
 */
export const effectivePermissions = (rows: PermissionRow[]): string[] => {
  const held = new Set(rows.filter((row) => row.source !== 'revoke').map((row) => row.name));
  for (const row of rows) if (row.source === 'revoke') held.delete(row.name);
  return [...held].sort();
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @repo/api exec node --test src/auth/rbac-rules.test.ts`

Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 5: Register the test file in the package test script**

In `apps/api/package.json`, the `test` script currently reads:

```json
"test": "node --test src/auth/refresh-window.test.ts src/auth/pin-policy.test.ts src/trpc/error-formatter.test.ts src/floor/floor-rules.test.ts drizzle/seed/seed-rbac.test.ts",
```

Change it to add the new file after `pin-policy.test.ts`:

```json
"test": "node --test src/auth/refresh-window.test.ts src/auth/pin-policy.test.ts src/auth/rbac-rules.test.ts src/trpc/error-formatter.test.ts src/floor/floor-rules.test.ts drizzle/seed/seed-rbac.test.ts",
```

- [ ] **Step 6: Run the whole suite**

Run: `pnpm --filter @repo/api test`

Expected: PASS, and the total test count is 6 higher than before this task.

- [ ] **Step 7: Leave the work uncommitted**

Do not commit. Run `git status --short` and confirm it lists `apps/api/src/auth/rbac-rules.ts`, `apps/api/src/auth/rbac-rules.test.ts` and `apps/api/package.json` as changed. Report the file list; the user reviews and commits.

---

### Task 2: The `user_permissions` table and its migration

Schema plus generated SQL migration. No code reads the table yet, so this task lands safely on its own — with zero override rows the system behaves exactly as it does today.

**Files:**
- Modify: `apps/api/src/db/schema.ts` (insert after the `export type Permission = ...` line, around line 95)
- Create: `apps/api/drizzle/0002_*.sql` (name generated by drizzle-kit — do not write it by hand)
- Modify: `apps/api/drizzle/meta/_journal.json` and a new `apps/api/drizzle/meta/0002_snapshot.json` (both written by drizzle-kit — do not edit by hand)

**Interfaces:**
- Consumes: the existing `users` and `permissions` tables from `apps/api/src/db/schema.ts`.
- Produces:
  - `userPermissions` — Drizzle table export with columns `userId`, `permissionId`, `effect`. Task 3 imports it from `../db/schema`.
  - `type UserPermission = typeof userPermissions.$inferSelect`

- [ ] **Step 1: Add the table to the schema**

In `apps/api/src/db/schema.ts`, find these two lines (they sit immediately after the `rolePermissions` table definition):

```ts
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
```

Insert this block directly **after** them:

```ts
/**
 * Per-user exceptions to what the role gives. One row per (user, permission): 'grant' adds what
 * the role lacks, 'revoke' takes back what it gives, and no row at all means inherit the role.
 * The primary key is what stops a grant and a revoke from ever fighting over the same permission.
 */
export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascade matters here: `seedRbac` deletes permissions dropped from PERMISSIONS, and an
    // override pointing at a permission that no longer exists must go with it.
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    effect: text('effect').$type<'grant' | 'revoke'>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionId] }),
    // This table decides who may do what: a misspelled effect has to fail at write time rather
    // than read back as neither a grant nor a revoke.
    check('user_permissions_effect', sql`${table.effect} IN ('grant', 'revoke')`),
  ],
);

export type UserPermission = typeof userPermissions.$inferSelect;
```

No import changes are needed — `sql`, `check`, `pgTable`, `primaryKey`, `text` and `uuid` are all already imported at the top of the file.

Do **not** add an index on `permission_id`. `role_permissions` has one for reverse lookups ("who holds X"); no such query exists against overrides yet, and it can be added with the code that needs it.

- [ ] **Step 2: Type-check the schema**

Run: `pnpm --filter @repo/api check-types`

Expected: PASS, no output. If `check` or `sql` is reported as unused or missing, re-read the import block at the top of `schema.ts` before changing anything else.

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @repo/api db:generate`

Expected: drizzle-kit prints that it created a new file under `apps/api/drizzle/`, named `0002_<random words>.sql`.

- [ ] **Step 4: Read the generated SQL and confirm it is correct**

Run: `cat apps/api/drizzle/0002_*.sql`

Expected: a `CREATE TABLE "user_permissions"` with `user_id uuid NOT NULL`, `permission_id uuid NOT NULL`, `effect text NOT NULL`, a two-column primary key, a `CHECK` constraint named `user_permissions_effect`, and two `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE cascade` statements.

If the file instead contains `DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, or changes to any table other than `user_permissions`, stop and report it — the schema file was edited beyond this task's scope and the migration must not be applied.

- [ ] **Step 5: Apply the migration**

Requires a running Postgres and `DATABASE_URL` set in `apps/api/.env` (see `apps/api/.env.example`; `docker-compose.yml` at the repo root starts the database).

Run: `pnpm --filter @repo/api db:migrate`

Expected: drizzle-kit reports the migration applied with no error.

- [ ] **Step 6: Confirm the table exists and rejects a bad effect**

Run, substituting the same connection string that is in `apps/api/.env`:

```bash
psql "$DATABASE_URL" -c "INSERT INTO user_permissions (user_id, permission_id, effect) SELECT u.id, p.id, 'nonsense' FROM users u, permissions p WHERE u.username = 'owner' AND p.name = 'table.view';"
```

Expected: FAIL with `new row for relation "user_permissions" violates check constraint "user_permissions_effect"`. That error is the success condition for this step — the CHECK is doing its job. Nothing is inserted.

If `psql` is not available, skip this step and say so in the report.

- [ ] **Step 7: Leave the work uncommitted**

Do not commit. Run `git status --short` and confirm it lists `apps/api/src/db/schema.ts`, the new `apps/api/drizzle/0002_*.sql`, `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/meta/0002_snapshot.json`. Report the file list.

---

### Task 3: Resolve overrides in `RbacService`

Wire the table and the rule into the single method every permission check goes through.

**Files:**
- Modify: `apps/api/src/auth/rbac.service.ts` (whole file — the replacement below is complete)

**Interfaces:**
- Consumes:
  - `effectivePermissions(rows: PermissionRow[]): string[]` and `type PermissionRow` from Task 1 (`./rbac-rules`)
  - `userPermissions` table from Task 2 (`../db/schema`)
- Produces: `RbacService.permissionsOf(userId: string): Promise<string[]>` — unchanged signature, now the effective set. `RbacService.require(userId, permission)` is unchanged and still throws `TRPCError` with code `FORBIDDEN`.

- [ ] **Step 1: Replace the service**

Replace the entire contents of `apps/api/src/auth/rbac.service.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { permissions, rolePermissions, userPermissions, users } from '../db/schema';
import { type PermissionRow, effectivePermissions } from './rbac-rules';

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What the user's role grants, plus their per-user grants, minus their per-user revokes. Empty
   * for a user with no role and no overrides. One round trip: `require` runs on every gated call.
   */
  async permissionsOf(userId: string): Promise<string[]> {
    const fromRole = this.db
      .select({ name: permissions.name, source: sql<PermissionRow['source']>`'role'` })
      .from(users)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, users.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(users.id, userId));

    const fromOverrides = this.db
      .select({
        name: permissions.name,
        // The stored effect *is* the source tag: 'grant' and 'revoke' need no mapping.
        source: sql<PermissionRow['source']>`${userPermissions.effect}`,
      })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(eq(userPermissions.userId, userId));

    return effectivePermissions(await unionAll(fromRole, fromOverrides));
  }

  /** FORBIDDEN, not UNAUTHORIZED: we know who this is, they just may not do this. */
  async require(userId: string, permission: string): Promise<void> {
    const held = await this.permissionsOf(userId);
    if (!held.includes(permission))
      throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${permission}.` });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/api check-types`

Expected: PASS, no output.

If `unionAll` rejects the two selects over a field-shape mismatch, do not reshape the rule or the table. Fall back to two queries — the only cost is a second round trip — by replacing the `return` line with:

```ts
    const [roleRows, overrideRows] = await Promise.all([fromRole, fromOverrides]);
    return effectivePermissions([...roleRows, ...overrideRows]);
```

and dropping the now-unused `unionAll` import. Report which of the two forms you shipped.

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter @repo/api test`

Expected: PASS. No test exercises `permissionsOf` itself — it is a query, and this repo has no database test harness — so this run is a regression check on the rest of the suite.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @repo/api lint`

Expected: PASS with no warnings (the script runs with `--max-warnings 0`).

- [ ] **Step 5: Smoke-test a revoke end to end**

Requires the database from Task 2 and `DATABASE_URL` exported in the shell.

Revoke `table.view` from the seeded owner, who holds every permission through their role:

```bash
psql "$DATABASE_URL" -c "INSERT INTO user_permissions (user_id, permission_id, effect) SELECT u.id, p.id, 'revoke' FROM users u, permissions p WHERE u.username = 'owner' AND p.name = 'table.view';"
```

Start the API (`pnpm --filter @repo/api dev`), log in as `owner` / `owner123` (from `drizzle/seed/seed-users.ts`) and call `auth.me`.

Expected: the `permissions` array no longer contains `table.view`, and still contains everything else — `settings.manage` included.

Then put it back:

```bash
psql "$DATABASE_URL" -c "DELETE FROM user_permissions;"
```

Call `auth.me` again. Expected: `table.view` is back. If `psql` or a running database is not available, skip this step and say so in the report.

- [ ] **Step 6: Leave the work uncommitted**

Do not commit. Run `git status --short` and report every changed file across all three tasks. The user reviews and commits.

---

## Done when

- `pnpm --filter @repo/api test` passes with the six new rule tests included.
- `pnpm --filter @repo/api check-types` and `lint` pass.
- `user_permissions` exists in the database with its CHECK constraint, and a revoke row visibly removes a permission from `auth.me` while its absence restores it.
- `packages/api-contract`, `apps/desktop` and `apps/mobile` are untouched.
- Nothing is committed.

## Deliberately not in this plan

Per the spec: no admin router (`users.list` / `users.get` / `users.setOverrides`), no `users.manage` permission, no admin UI, and no lockout guard against revoking the owner's `settings.manage` — that validation belongs at the write boundary, which does not exist yet.
