# Outlet Roles and Active Outlet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user's role is decided per outlet (`outlet_staff.role_id`), the owner keeps a global role (`users.role_id`), and every session carries an active outlet that the permission check reads.

**Architecture:** Three schema changes (`outlet_staff.role_id`, `refresh_tokens.outlet_id`, `users.role_id` re-meaning) and one migration with a backfill. `AuthService` computes a user's outlets, stamps the chosen one into the JWT and onto the refresh row, and `auth.refresh` gains an optional `outletId` so it doubles as the picker. `RbacService.permissionsOf(userId, outletId)` reads the role from `users.role_id` or from the membership row for that outlet. `ProtectedMiddleware` puts `{ user, outletId, global }` on ctx. Desktop and mobile branch three ways: login, pick outlet, home.

**Tech Stack:** NestJS 11 + nestjs-trpc 2.13, Drizzle ORM 0.45 on node-postgres, zod 4.5, vitest 5 with a per-run test database, Electron renderer (React 19), Expo SDK 57 + expo-router.

**Spec:** `docs/superpowers/specs/2026-09-18-outlet-roles-design.md`

## Global Constraints

- **No commits, no branches, no worktrees.** The user works on `main` and commits themselves. Every task ends in a verification step, not a commit. Leave changes uncommitted in the working tree.
- **Every zod bound is an inline literal** inside the decorator. The contract generator cannot hoist an identifier a schema references — write `z.string().max(60)`, never `z.string().max(NAME_MAX)`.
- **`packages/api-contract/src/server.ts` is generated.** Never hand-edit it. Regenerate with `pnpm trpc:generate` after any router change; the regenerated file is part of the deliverable.
- **Error codes are load-bearing.** Both clients end the session on any `UNAUTHORIZED`. Every refusal this plan adds is `FORBIDDEN` or `BAD_REQUEST`, with these exact messages: `Not assigned to this outlet.`, `Wrong outlet.`, `Owner is global.`
- **All commands run from the repo root** `/Users/ceye/Metasoft/pos-d4` unless stated otherwise.
- **A running Postgres with `DATABASE_URL` in `apps/api/.env`** is needed by every task that runs `vitest` against a `*.service.test.ts` file, and by `pnpm db:migrate`. `docker compose up -d` starts it.
- **API tests use vitest with a glob**: a new `src/**/*.test.ts` runs automatically. Pure-rule tests use `node:assert/strict` inside `vitest`'s `test`; database tests use `expect` and `connectTestDatabase()` from `src/test/test-db.ts`.
- Column names are exactly `outlet_staff.role_id` and `refresh_tokens.outlet_id`. The JWT claim is `outletId`.
- Formatting is Prettier at the root: `pnpm exec prettier --write <files>` (single quotes, 110 cols).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/db/schema.ts` (modify) | `outletStaff.roleId`, `refreshTokens.outletId`, doc comment on `users.roleId`. |
| `apps/api/drizzle/0004_*.sql` (generated, then hand-extended) | Column adds plus the backfill SQL. |
| `apps/api/src/test/test-db.ts` (modify) | `truncateAll` also clears `refresh_tokens`, `user_permissions`. |
| `apps/api/src/auth/rbac-rules.ts` (modify) | `canActOn` pure helper and the `Actor` type. |
| `apps/api/src/auth/rbac-rules.test.ts` (modify) | `canActOn` cases. |
| `apps/api/src/auth/rbac.service.ts` (modify) | `permissionsOf(userId, outletId)`, `require(actor, permission)`. |
| `apps/api/src/auth/rbac.service.test.ts` (create) | Database tests for the role source. |
| `apps/api/src/auth/auth.service.ts` (modify) | `outletsOf`, `issueSession(user, outletId)`, `login`/`refresh`/`pinLogin`/`register` changes, `Session` type. |
| `apps/api/src/auth/auth.service.test.ts` (create) | Database tests for stamping and carry-forward. |
| `apps/api/src/auth/protected.middleware.ts` (modify) | Puts `outletId` and `global` on ctx. |
| `apps/api/src/auth/auth.router.ts` (modify) | `sessionOutput` gains `outlet`/`outlets`; `refresh` input gains `outletId`; `me` returns `outletId`. |
| `apps/api/src/floor/table.router.ts`, `reservation.router.ts`, `settings/settings.router.ts` (modify) | `rbac.require(ctx, …)` call sites and the `Ctx` type. |
| `apps/api/src/outlet/outlet-rules.ts` (modify) | `staffDiff` keyed on `(userId, roleId)`; `OWNER_ROLE` guard. |
| `apps/api/src/outlet/outlet-rules.test.ts` (modify) | New diff cases. |
| `apps/api/src/outlet/outlet.service.ts` (modify) | `setStaff(outletId, staff)` with roles; owner rejection; `roleId` in `StaffOutput`. |
| `apps/api/src/outlet/outlet.service.test.ts` (modify) | Existing roster tests take a role; new owner-rejection test. |
| `apps/api/src/outlet/outlet.router.ts` (modify) | New `setStaff` input, `roleId` in output, `canActOn` gate. |
| `packages/api-contract/src/server.ts` (regenerated) | — |
| `apps/desktop/src/renderer/src/stores/auth.ts` (modify) | `outlet`, `outlets`, `switching`. |
| `apps/desktop/src/renderer/src/components/outlet-picker.tsx` (create) | The picker. |
| `apps/desktop/src/renderer/src/app.tsx` (modify) | Three-way branch, outlet name and Switch in `Home`. |
| `apps/mobile/src/lib/stores/auth.ts` (modify) | `outlet`, `outlets`, `switching`. |
| `apps/mobile/src/app/outlet.tsx` (create) | The picker screen. |
| `apps/mobile/src/app/index.tsx` (modify) | Redirect to `/outlet` when no active outlet. |

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/src/db/schema.ts:15-32` (users), `:34-60` (refreshTokens), `:225-246` (outletStaff)
- Modify: `apps/api/src/test/test-db.ts:73-76`
- Create (generated): `apps/api/drizzle/0004_<name>.sql`

**Interfaces:**
- Produces: `outletStaff.roleId: uuid NOT NULL`, `refreshTokens.outletId: uuid | null`, and the types `OutletStaff`, `RefreshToken` reflecting them. `users.roleId` unchanged in shape; its meaning is now "global role".

- [ ] **Step 1: Edit the schema**

In `apps/api/src/db/schema.ts`, replace the `roleId` line inside `users` with:

```ts
  // The GLOBAL role: applies at every outlet and needs no `outlet_staff` row. Only the owner is
  // meant to have one; everyone else's role lives on `outlet_staff.role_id` per outlet. No API
  // sets this yet — only the seed does.
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
```

Inside `refreshTokens`, after the `revokedReason` line, add:

```ts
    // The session's active outlet. Lives on the row, not the client, so rotation, PIN unlock and a
    // parked profile all carry it. Null: not chosen yet (zero or many outlets), or the outlet went.
    outletId: uuid('outlet_id').references(() => outlets.id, { onDelete: 'set null' }),
```

`outlets` is declared later in the file than `refreshTokens`. Drizzle resolves the lazy `() => outlets.id` at query time, so declaration order does not matter — same trick `users.roleId` already uses with `roles`.

Inside `outletStaff`, after the `userId` column, add:

```ts
    // What this user IS at this outlet. Restrict, not cascade: roles are never pruned by the seed,
    // and a hard delete of one must not silently strip staff of their role.
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
```

Update the doc comment above `outletStaff` to:

```ts
/** Which staff may work at an outlet, and as what. No row = not assigned; zero outlets is a valid state. */
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `apps/api/drizzle/0004_<random>.sql` with three statements — `ALTER TABLE "outlet_staff" ADD COLUMN "role_id" uuid NOT NULL;`, `ALTER TABLE "refresh_tokens" ADD COLUMN "outlet_id" uuid;`, and the two `ADD CONSTRAINT … FOREIGN KEY` lines. Also an updated `drizzle/meta/_journal.json` and a new `drizzle/meta/0004_snapshot.json`.

- [ ] **Step 3: Hand-extend the migration with the backfill**

Open the generated `0004_*.sql`. A `NOT NULL` column cannot be added to a table with rows, so replace the `outlet_staff` `ADD COLUMN` line with this sequence (keep the `--> statement-breakpoint` markers — the migrator splits on them):

```sql
ALTER TABLE "outlet_staff" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "outlet_staff" s SET "role_id" = u."role_id" FROM "users" u WHERE u."id" = s."user_id" AND u."role_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "outlet_staff" WHERE "role_id" IS NULL;--> statement-breakpoint
ALTER TABLE "outlet_staff" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role_id" = NULL WHERE "role_id" IS NOT NULL AND "role_id" <> (SELECT "id" FROM "roles" WHERE "name" = 'owner');--> statement-breakpoint
```

Leave the `refresh_tokens` `ADD COLUMN` and both `ADD CONSTRAINT` lines as generated, after the block above. The last line of the file has no trailing breakpoint.

- [ ] **Step 4: Widen `truncateAll`**

In `apps/api/src/test/test-db.ts` replace the `truncateAll` body with:

```ts
/** Every table these tests touch, plus whatever cascades off `users`. Roles and permissions stay: they are seed data. */
export const truncateAll = async (db: TestDatabase): Promise<void> => {
  await db.execute(
    sql`truncate table refresh_tokens, user_permissions, outlet_staff, outlets, users restart identity cascade`,
  );
};
```

- [ ] **Step 5: Migrate the dev database and the test database**

Run: `pnpm db:migrate`
Expected: `[✓] migrations applied successfully!` or similar, no error. If the dev database predates the squash, the CLAUDE.md reset applies: `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`.

Run: `pnpm --filter @repo/api exec vitest run src/outlet/outlet.service.test.ts`
Expected: FAIL — every `setStaff` test errors with `null value in column "role_id" of relation "outlet_staff" violates not-null constraint`. That is correct for now; Task 6 fixes the service. The first line of output should show the test database migrated (no migration error).

- [ ] **Step 6: Type check**

Run: `pnpm --filter @repo/api check-types`
Expected: PASS (nothing reads the new columns yet).

---

### Task 2: `canActOn` pure rule

**Files:**
- Modify: `apps/api/src/auth/rbac-rules.ts`
- Modify: `apps/api/src/auth/rbac-rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Actor = { user: { id: string }; outletId: string | null; global: boolean };
  export const canActOn = (actor: Actor, outletId: string): boolean;
  ```
  `Actor` is the shape `ProtectedMiddleware` puts on ctx (Task 5) and what `RbacService.require` takes (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/auth/rbac-rules.test.ts`:

```ts
import { canActOn, type Actor } from './rbac-rules.ts';

const actor = (outletId: string | null, global = false): Actor => ({ user: { id: 'u1' }, outletId, global });

test('a global role acts on any outlet, active or not', () => {
  assert.equal(canActOn(actor(null, true), 'o1'), true);
  assert.equal(canActOn(actor('o2', true), 'o1'), true);
});

test('a scoped user acts only on the active outlet', () => {
  assert.equal(canActOn(actor('o1'), 'o1'), true);
  assert.equal(canActOn(actor('o1'), 'o2'), false);
});

test('no active outlet means no outlet at all', () => {
  assert.equal(canActOn(actor(null), 'o1'), false);
});
```

Merge the new `import` with the existing one at the top of the file: `import { type PermissionRow, canActOn, effectivePermissions, type Actor } from './rbac-rules.ts';`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/api exec vitest run src/auth/rbac-rules.test.ts`
Expected: FAIL — `canActOn` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/api/src/auth/rbac-rules.ts`:

```ts
/** Who is calling: the bearer, their active outlet, and whether their role is global (see `users.roleId`). */
export type Actor = { user: { id: string }; outletId: string | null; global: boolean };

/**
 * May this caller touch outlet-scoped data for `outletId`? A global role may touch any outlet;
 * everyone else is confined to the outlet their session is for.
 */
export const canActOn = (actor: Actor, outletId: string): boolean =>
  actor.global || actor.outletId === outletId;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/api exec vitest run src/auth/rbac-rules.test.ts`
Expected: PASS, 9 tests.

---

### Task 3: `RbacService` reads the role per outlet

**Files:**
- Modify: `apps/api/src/auth/rbac.service.ts`
- Create: `apps/api/src/auth/rbac.service.test.ts`

**Interfaces:**
- Consumes: `Actor` from Task 2; `outletStaff.roleId` from Task 1.
- Produces:
  ```ts
  permissionsOf(userId: string, outletId: string | null): Promise<string[]>
  require(actor: Actor, permission: string): Promise<void>
  ```
  Every router call site changes from `rbac.require(ctx.user.id, 'x')` to `rbac.require(ctx, 'x')` in Task 5.

- [ ] **Step 0: Let `src` tests import the seed**

The tests below import `drizzle/seed/seed-rbac.ts` from `src/`. `apps/api/tsconfig.json` has `rootDir: ./src`, so `tsc --noEmit -p tsconfig.json` would fail with TS6059 (`not under 'rootDir'`) on that import. `tsconfig.seed.json` already covers `src` *and* `drizzle` with `rootDir: .` and `noEmit`, so it is the one type check needed. `nest build` uses `tsconfig.build.json`, which excludes `**/*.test.ts`, so the build never sees the import.

In `apps/api/package.json` change the `check-types` script to:

```json
    "check-types": "tsc -p tsconfig.seed.json"
```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/auth/rbac.service.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { outletStaff, outlets, permissions, roles, userPermissions, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { RbacService } from './rbac.service';

let db: TestDatabase;
let close: () => Promise<void>;
let rbac: RbacService;
let roleId: Record<string, string>;
let permissionId: (name: string) => Promise<string>;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  // Roles and permissions are seed data and survive truncateAll; seeding is idempotent.
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  permissionId = async (name) =>
    (await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.name, name)))[0]!.id;
  rbac = new RbacService(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const addUser = async (username: string, globalRole: string | null = null) => {
  const [row] = await db
    .insert(users)
    .values({
      username,
      name: username,
      passwordHash: 'not-a-real-hash',
      roleId: globalRole ? roleId[globalRole] : null,
    })
    .returning();
  return row!;
};

const addOutlet = async (code: string) => {
  const [row] = await db.insert(outlets).values({ name: code, code }).returning();
  return row!;
};

const assign = (userId: string, outletId: string, role: string) =>
  db.insert(outletStaff).values({ userId, outletId, roleId: roleId[role]! });

test('a global role holds its permissions at any outlet, and with no outlet at all', async () => {
  const owner = await addUser('owner', 'owner');
  const o1 = await addOutlet('O1');

  expect(await rbac.permissionsOf(owner.id, o1.id)).toContain('outlet.manage');
  expect(await rbac.permissionsOf(owner.id, null)).toContain('outlet.manage');
});

test('a scoped user holds the role of the active outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');
  await assign(ann.id, o2.id, 'manager');

  expect(await rbac.permissionsOf(ann.id, o1.id)).not.toContain('table.create');
  expect(await rbac.permissionsOf(ann.id, o2.id)).toContain('table.create');
});

test('the wrong outlet, or none, gives a scoped user no role permissions', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  const o2 = await addOutlet('O2');
  await assign(ann.id, o1.id, 'cashier');

  expect(await rbac.permissionsOf(ann.id, o2.id)).toEqual([]);
  expect(await rbac.permissionsOf(ann.id, null)).toEqual([]);
});

test('per-user grants are global: they survive a null outlet', async () => {
  const ann = await addUser('ann');
  await db
    .insert(userPermissions)
    .values({ userId: ann.id, permissionId: await permissionId('table.view'), effect: 'grant' });

  expect(await rbac.permissionsOf(ann.id, null)).toEqual(['table.view']);
});

test('a revoke still takes back what the outlet role gives', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await assign(ann.id, o1.id, 'cashier');
  await db
    .insert(userPermissions)
    .values({ userId: ann.id, permissionId: await permissionId('sales.create'), effect: 'revoke' });

  const held = await rbac.permissionsOf(ann.id, o1.id);
  expect(held).toContain('sales.view');
  expect(held).not.toContain('sales.create');
});

test('require is FORBIDDEN, never UNAUTHORIZED', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('O1');
  await assign(ann.id, o1.id, 'cashier');
  const actor = { user: { id: ann.id }, outletId: o1.id, global: false };

  await expect(rbac.require(actor, 'sales.create')).resolves.toBeUndefined();
  await expect(rbac.require(actor, 'outlet.manage')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Requires outlet.manage.',
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/api exec vitest run src/auth/rbac.service.test.ts`
Expected: FAIL — type errors or wrong results: `permissionsOf` takes one argument, `require` expects a string.

- [ ] **Step 3: Implement**

Replace the whole of `apps/api/src/auth/rbac.service.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module';
import { outletStaff, permissions, rolePermissions, userPermissions, users } from '../db/schema';
import { type Actor, type PermissionRow, effectivePermissions } from './rbac-rules';

/** Role → permission lookups. The code checks permission *names* (`domain.action`), never ids. */
@Injectable()
export class RbacService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What the user's role at `outletId` grants, plus their per-user grants, minus their per-user
   * revokes. The role is `users.role_id` when set (global — owner), otherwise the `outlet_staff`
   * row for that outlet. No outlet and no global role means no role permissions at all; only
   * grants survive. One round trip: `require` runs on every gated call.
   */
  async permissionsOf(userId: string, outletId: string | null): Promise<string[]> {
    // `sql\`false\`` keeps the join shape identical when there is no outlet to match: the left join
    // yields nulls, coalesce falls through to users.role_id, and a scoped user gets nothing.
    const membership = outletId ? eq(outletStaff.outletId, outletId) : sql`false`;
    const roleId = sql`coalesce(${users.roleId}, ${outletStaff.roleId})`;

    const fromRole = this.db
      .select({ name: permissions.name, source: sql<PermissionRow['source']>`'role'` })
      .from(users)
      .leftJoin(outletStaff, and(eq(outletStaff.userId, users.id), membership))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleId))
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
  async require(actor: Actor, permission: string): Promise<void> {
    const held = await this.permissionsOf(actor.user.id, actor.outletId);
    if (!held.includes(permission))
      throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${permission}.` });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/api exec vitest run src/auth/rbac.service.test.ts`
Expected: PASS, 6 tests.

Note: `check-types` fails from here until Task 5 updates the routers. That is expected — do not run it yet.

---

### Task 4: `AuthService` stamps and carries the active outlet

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.service.test.ts`

**Interfaces:**
- Consumes: `refreshTokens.outletId`, `outletStaff.roleId` (Task 1).
- Produces:
  ```ts
  export type OutletRef = { id: string; name: string };
  export interface Session { user: PublicUser; accessToken: string; refreshToken: string; outlet: OutletRef | null; outlets: OutletRef[] }
  export type AccessPayload = { sub: string; username: string; outletId: string | null };
  refresh(token: string, outletId?: string): Promise<Session>
  userFromAccessToken(token: string): Promise<{ user: User; outletId: string | null }>
  ```
  `login`, `register`, `pinLogin` keep their signatures but return the wider `Session`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/auth/auth.service.test.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { outletStaff, outlets, refreshTokens, roles, users } from '../db/schema';
import { connectTestDatabase, truncateAll, type TestDatabase } from '../test/test-db';
import { AuthService } from './auth.service';

let db: TestDatabase;
let close: () => Promise<void>;
let auth: AuthService;
let roleId: Record<string, string>;

const PASSWORD = 'password123';
let passwordHash: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
  passwordHash = await argon2.hash(PASSWORD);
  auth = new AuthService(
    db,
    new JwtService({}),
    new ConfigService({ JWT_ACCESS_SECRET: 'test-secret', JWT_ACCESS_TTL: '15m' }),
  );
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const addUser = async (username: string, globalRole: string | null = null) => {
  const [row] = await db
    .insert(users)
    .values({ username, name: username, passwordHash, roleId: globalRole ? roleId[globalRole] : null })
    .returning();
  return row!;
};

const addOutlet = async (name: string) => {
  const [row] = await db.insert(outlets).values({ name, code: name }).returning();
  return row!;
};

const assign = (userId: string, outletId: string, role = 'cashier') =>
  db.insert(outletStaff).values({ userId, outletId, roleId: roleId[role]! });

const login = (username: string) => auth.login({ username, password: PASSWORD });

test('login auto-stamps the only outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  await assign(ann.id, o1.id);

  const session = await login('ann');
  expect(session.outlet).toEqual({ id: o1.id, name: 'One' });
  expect(session.outlets).toEqual([{ id: o1.id, name: 'One' }]);
  expect((await auth.userFromAccessToken(session.accessToken)).outletId).toBe(o1.id);
});

test('login with many outlets leaves the choice to the client', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const session = await login('ann');
  expect(session.outlet).toBeNull();
  expect(session.outlets.map((o) => o.name)).toEqual(['One', 'Two']);
});

test('login with no outlets is allowed and says so', async () => {
  await addUser('ann');
  const session = await login('ann');
  expect(session.outlet).toBeNull();
  expect(session.outlets).toEqual([]);
});

test('a global role sees every live outlet', async () => {
  const owner = await addUser('owner', 'owner');
  await addOutlet('One');
  const gone = await addOutlet('Gone');
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, gone.id));

  const session = await login('owner');
  expect(session.outlets.map((o) => o.name)).toEqual(['One']);
  expect(session.outlet?.name).toBe('One');
  expect(session.user.id).toBe(owner.id);
});

test('refresh with an outletId stamps it; without one it carries forward', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const first = await login('ann');
  const picked = await auth.refresh(first.refreshToken, o2.id);
  expect(picked.outlet?.id).toBe(o2.id);

  const carried = await auth.refresh(picked.refreshToken);
  expect(carried.outlet?.id).toBe(o2.id);
  expect((await auth.userFromAccessToken(carried.accessToken)).outletId).toBe(o2.id);
});

test('refresh with an outlet the user is not assigned to is FORBIDDEN and consumes nothing', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);

  const first = await login('ann');
  await expect(auth.refresh(first.refreshToken, o2.id)).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'Not assigned to this outlet.',
  });
  // The token is still live: the refusal happened before rotation.
  const again = await auth.refresh(first.refreshToken);
  expect(again.outlet?.id).toBe(o1.id);
});

test('an outlet that closed comes back as null when a choice remains', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  const o3 = await addOutlet('Three');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);
  await assign(ann.id, o3.id);

  const session = await auth.refresh((await login('ann')).refreshToken, o1.id);
  await db.update(outlets).set({ deletedAt: new Date() }).where(eq(outlets.id, o1.id));

  const next = await auth.refresh(session.refreshToken);
  expect(next.outlet).toBeNull();
  expect(next.outlets.map((o) => o.name)).toEqual(['Three', 'Two']);
});

test('losing a membership falls back to the one outlet left, same rule as login', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);

  const session = await auth.refresh((await login('ann')).refreshToken, o1.id);
  await db.delete(outletStaff).where(eq(outletStaff.outletId, o1.id));

  const next = await auth.refresh(session.refreshToken);
  expect(next.outlet?.id).toBe(o2.id);
});

test('pinLogin carries the parked row outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  const o2 = await addOutlet('Two');
  await assign(ann.id, o1.id);
  await assign(ann.id, o2.id);
  await auth.setPin(ann.id, { pin: '123456' });

  const session = await auth.refresh((await login('ann')).refreshToken, o2.id);
  await auth.park(session.refreshToken);

  const unlocked = await auth.pinLogin(session.refreshToken, '123456');
  expect(unlocked.outlet?.id).toBe(o2.id);
});

test('the refresh row records the outlet', async () => {
  const ann = await addUser('ann');
  const o1 = await addOutlet('One');
  await assign(ann.id, o1.id);
  await login('ann');

  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, ann.id));
  expect(row?.outletId).toBe(o1.id);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/api exec vitest run src/auth/auth.service.test.ts`
Expected: FAIL — `session.outlet` undefined, `refresh` ignores its second argument, `userFromAccessToken` returns a `User` without `outletId`.

- [ ] **Step 3: Implement**

In `apps/api/src/auth/auth.service.ts`:

Change the drizzle import and schema import to:

```ts
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { outletStaff, outlets, refreshTokens, users, type User } from '../db/schema';
```

Replace the `Session` interface with:

```ts
/** An outlet as the session names it. The picker needs nothing more. */
export type OutletRef = { id: string; name: string };

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  /** The active outlet. Null until chosen (zero or many outlets), or when the chosen one is gone. */
  outlet: OutletRef | null;
  /** Every outlet this user may work at: all live outlets for a global role, else their memberships. */
  outlets: OutletRef[];
}

/** What the access JWT carries. `outletId` is what `RbacService` scopes the role by. */
export type AccessPayload = { sub: string; username: string; outletId: string | null };
```

Add `notAssigned` beside `alive`:

```ts
/** FORBIDDEN: we know who this is; they just do not work there. A 401 would sign them out. */
const notAssigned = () => new TRPCError({ code: 'FORBIDDEN', message: 'Not assigned to this outlet.' });
```

`register` and `login` keep their final lines (`return this.issueSession(user!);` and `return this.issueSession(user);`). `issueSession` below picks the single outlet itself when nothing is passed, which is the auto-select rule.

Change `refresh`'s signature and its ending:

```ts
  async refresh(token: string, outletId?: string): Promise<Session> {
```

Insert, right after the `if (!user) throw …` line and before the `// Rotate:` comment:

```ts
    // Checked before rotation so a refused pick leaves the presented token usable.
    if (outletId !== undefined && !(await this.outletsOf(user)).some((o) => o.id === outletId))
      throw notAssigned();
```

and change its final line to:

```ts
    return this.issueSession(user, outletId ?? row.outletId);
```

Change `pinLogin`'s final line to:

```ts
    return this.issueSession(user, row.outletId);
```

Replace `userFromAccessToken` with:

```ts
  async userFromAccessToken(token: string): Promise<{ user: User; outletId: string | null }> {
    const payload = await this.jwt
      .verifyAsync<AccessPayload>(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') })
      .catch(() => {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid access token.' });
      });
    return { user: await this.userFromPayload(payload), outletId: payload.outletId ?? null };
  }
```

Replace `issueSession` with:

```ts
  /** The outlets a user may work at, live only, sorted by name. A global role works everywhere. */
  private async outletsOf(user: User): Promise<OutletRef[]> {
    const query = this.db.select({ id: outlets.id, name: outlets.name }).from(outlets);
    return user.roleId
      ? query.where(isNull(outlets.deletedAt)).orderBy(asc(outlets.name))
      : query
          .innerJoin(outletStaff, eq(outletStaff.outletId, outlets.id))
          .where(and(eq(outletStaff.userId, user.id), isNull(outlets.deletedAt)))
          .orderBy(asc(outlets.name));
  }

  /**
   * `wanted` is the caller's choice (a pick, or the outlet carried on the refresh row); undefined
   * means "none yet". Either way it only sticks while the user may still work there, and a lone
   * outlet is chosen for them — so a closed outlet or a lost membership silently falls back to
   * null (re-pick) or to the one outlet left.
   */
  private async issueSession(user: User, wanted?: string | null): Promise<Session> {
    const mine = await this.outletsOf(user);
    const outlet = mine.find((o) => o.id === wanted) ?? (mine.length === 1 ? mine[0]! : null);
    const outletId = outlet?.id ?? null;

    const payload: AccessPayload = { sub: user.id, username: user.username, outletId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });

    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS', '30'));
    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      outletId,
    });

    return { user: publicUser(user), accessToken, refreshToken, outlet, outlets: mine };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/api exec vitest run src/auth/auth.service.test.ts`
Expected: PASS, 10 tests. (`argon2` makes this file take a few seconds.)

---

### Task 5: Middleware, routers, contract

**Files:**
- Modify: `apps/api/src/auth/protected.middleware.ts`
- Modify: `apps/api/src/auth/auth.router.ts`
- Modify: `apps/api/src/floor/table.router.ts`, `apps/api/src/floor/reservation.router.ts`, `apps/api/src/settings/settings.router.ts`, `apps/api/src/outlet/outlet.router.ts`
- Regenerate: `packages/api-contract/src/server.ts`

**Interfaces:**
- Consumes: `Actor` (Task 2), `RbacService.require(actor, permission)` (Task 3), `Session`/`userFromAccessToken` (Task 4).
- Produces: ctx shape `{ user: PublicUser; outletId: string | null; global: boolean }` on every protected procedure; `auth.refresh` input `{ refreshToken, outletId? }`; `sessionOutput` with `outlet`/`outlets`; `auth.me` with `outletId`.

- [ ] **Step 1: Middleware**

Replace the body of `use` in `apps/api/src/auth/protected.middleware.ts` from `const user = …` to the end with:

```ts
    const { user, outletId } = await this.authService.userFromAccessToken(token);

    // `global` is server-side only: whether the role comes from `users.role_id` (owner) rather
    // than the active outlet's membership row. `canActOn` reads it; clients never see it.
    return next({ ctx: { user: publicUser(user), outletId, global: user.roleId !== null } });
```

- [ ] **Step 2: Auth router**

In `apps/api/src/auth/auth.router.ts`:

Replace `sessionOutput` with:

```ts
const outletRef = z.object({ id: z.string(), name: z.string() });
const sessionOutput = z.object({
  user: userOutput,
  accessToken: z.string(),
  refreshToken: z.string(),
  outlet: outletRef.nullable(),
  outlets: z.array(outletRef),
});
```

Replace the `refresh` procedure with:

```ts
  // `outletId` makes this the outlet picker too: choosing or switching an outlet is exactly
  // "reissue my session", which refresh already is. Omitted, the row's outlet carries forward.
  @Mutation({
    input: z.object({ refreshToken: z.string().min(1), outletId: z.uuid().optional() }),
    output: sessionOutput,
  })
  refresh(@Input() input: { refreshToken: string; outletId?: string }) {
    return this.authService.refresh(input.refreshToken, input.outletId);
  }
```

Replace the `me` procedure with:

```ts
  // Extends rather than re-declares, so a field added to `userOutput` reaches `me` too.
  @Query({
    output: userOutput.extend({ outletId: z.string().nullable(), permissions: z.array(z.string()) }),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async me(@Ctx() ctx: Actor & { user: PublicUser }) {
    return { ...ctx.user, outletId: ctx.outletId, permissions: await this.rbac.permissionsOf(ctx.user.id, ctx.outletId) };
  }
```

Add `import type { Actor } from './rbac-rules';` to the imports.

- [ ] **Step 3: Every other router**

In `apps/api/src/floor/table.router.ts`, `apps/api/src/floor/reservation.router.ts` and `apps/api/src/outlet/outlet.router.ts`, replace

```ts
type Ctx = { user: PublicUser };
```

with

```ts
type Ctx = Actor & { user: PublicUser };
```

and add `import type { Actor } from '../auth/rbac-rules';`. Then, in those three files and in `apps/api/src/settings/settings.router.ts`, replace every `this.rbac.require(ctx.user.id, ` with `this.rbac.require(ctx, `. In `settings.router.ts` the parameter type `@Ctx() ctx: { user: PublicUser }` becomes `@Ctx() ctx: Actor & { user: PublicUser }` with the same import.

Verify nothing is left: `grep -rn "require(ctx.user.id" apps/api/src` prints nothing.

- [ ] **Step 4: Type check and regenerate the contract**

Run: `pnpm --filter @repo/api check-types`
Expected: PASS.

Run: `pnpm trpc:generate`
Expected: `packages/api-contract/src/server.ts` rewritten. `grep -n "outletId: z.uuid().optional()" packages/api-contract/src/server.ts` finds the refresh input; `grep -c "outlets: z.array" packages/api-contract/src/server.ts` prints at least 4 (register, login, refresh, pinLogin).

- [ ] **Step 5: Contract package fixture**

`packages/api-contract/src/refresh.test.ts` builds a `Session` literal that no longer type-checks. Replace its `session` helper with:

```ts
const session = (accessToken: string, refreshToken = 'r2'): Session => ({
  user: { id: 'u1', name: 'Ada', username: 'ada', hasPin: false },
  accessToken,
  refreshToken,
  outlet: null,
  outlets: [],
});
```

Run: `pnpm --filter @repo/api-contract check-types && pnpm --filter @repo/api-contract test`
Expected: both PASS.

- [ ] **Step 6: Whole API suite**

Run: `pnpm api:test`
Expected: everything passes except `src/outlet/outlet.service.test.ts`, whose `setStaff` cases still fail on the NOT NULL `role_id`. Task 6 fixes them.

---

### Task 6: `setStaff` takes a role per user

**Files:**
- Modify: `apps/api/src/outlet/outlet-rules.ts`
- Modify: `apps/api/src/outlet/outlet-rules.test.ts`
- Modify: `apps/api/src/outlet/outlet.service.ts`
- Modify: `apps/api/src/outlet/outlet.service.test.ts`
- Modify: `apps/api/src/outlet/outlet.router.ts`
- Regenerate: `packages/api-contract/src/server.ts`

**Interfaces:**
- Consumes: `canActOn` (Task 2), ctx shape (Task 5).
- Produces:
  ```ts
  export type StaffEntry = { userId: string; roleId: string };
  export const staffDiff = (current: StaffEntry[], desired: StaffEntry[]) => { add: StaffEntry[]; remove: string[] };
  export const OWNER_ROLE = 'owner';
  // service
  setStaff(outletId: string, staff: StaffEntry[]): Promise<StaffOutput[]>   // StaffOutput gains roleId
  ```
  Router input: `{ outletId: uuid, staff: { userId: uuid, roleId: uuid }[] (max 200) }`.

- [ ] **Step 1: Failing rule tests**

In `apps/api/src/outlet/outlet-rules.test.ts` replace the five `staffDiff` tests with:

```ts
const e = (userId: string, roleId = 'r1') => ({ userId, roleId });

test('disjoint rosters swap wholesale', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], [e('c')]), { add: [e('c')], remove: ['a', 'b'] });
});

test('an unchanged roster writes nothing', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], [e('b'), e('a')]), { add: [], remove: [] });
});

test('a changed role is a remove plus an add for the same user', () => {
  assert.deepEqual(staffDiff([e('a', 'cashier')], [e('a', 'manager')]), {
    add: [e('a', 'manager')],
    remove: ['a'],
  });
});

test('an empty roster removes everyone', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], []), { add: [], remove: ['a', 'b'] });
});

test('a duplicate user in the desired list keeps the last role given', () => {
  assert.deepEqual(staffDiff([], [e('a', 'cashier'), e('a', 'manager')]), {
    add: [e('a', 'manager')],
    remove: [],
  });
});

test('an outlet with no staff yet just adds', () => {
  assert.deepEqual(staffDiff([], [e('a'), e('b')]), { add: [e('a'), e('b')], remove: [] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/api exec vitest run src/outlet/outlet-rules.test.ts`
Expected: FAIL on the diff cases.

- [ ] **Step 3: Implement the rules**

In `apps/api/src/outlet/outlet-rules.ts` replace `staffDiff` with:

```ts
/** One roster line: who, and as what. */
export type StaffEntry = { userId: string; roleId: string };

/** The one role that never goes on a roster: it is global (`users.role_id`), so a manager cannot hand it out. */
export const OWNER_ROLE = 'owner';

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
    add: [...wanted].filter(([userId, roleId]) => held.get(userId) !== roleId).map(([userId, roleId]) => ({ userId, roleId })),
    remove: [...held].filter(([userId, roleId]) => wanted.get(userId) !== roleId).map(([userId]) => userId),
  };
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/api exec vitest run src/outlet/outlet-rules.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Failing service tests**

In `apps/api/src/outlet/outlet.service.test.ts`:

Add imports and role lookup:

```ts
import { seedRbac } from '../../drizzle/seed/seed-rbac';
import { roles, users } from '../db/schema';
```

(replace the existing `import { users } from '../db/schema';`). In `beforeAll`, after `service = new OutletService(db);` add:

```ts
  await seedRbac(db);
  roleId = Object.fromEntries((await db.select().from(roles)).map((r) => [r.name, r.id]));
```

and declare `let roleId: Record<string, string>;` beside the other `let`s. Add a helper below `anOutlet`:

```ts
const as = (userId: string, role = 'cashier') => ({ userId, roleId: roleId[role]! });
```

Then update every `setStaff` call in the existing tests: `[zoe.id, ann.id]` → `[as(zoe.id), as(ann.id)]`, `[ann.id]` → `[as(ann.id)]`, `[ann.id, ann.id]` → `[as(ann.id), as(ann.id)]`, `[bob.id, ghost]` → `[as(bob.id), as(ghost)]`, `[gone.id]` → `[as(gone.id)]`, `[ann.id, bob.id]` → `[as(ann.id), as(bob.id)]`. `[]` stays `[]`.

Append new tests:

```ts
test('the roster reports each member role', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const roster = await service.setStaff(outlet.id, [as(ann.id, 'manager')]);
  expect(roster[0]?.roleId).toBe(roleId.manager);
});

test('changing a member role replaces the row', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await service.setStaff(outlet.id, [as(ann.id, 'cashier')]);
  const roster = await service.setStaff(outlet.id, [as(ann.id, 'manager')]);
  expect(roster).toHaveLength(1);
  expect(roster[0]?.roleId).toBe(roleId.manager);
});

test('the owner role never goes on a roster', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  await expect(service.setStaff(outlet.id, [as(ann.id, 'owner')])).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Owner is global.',
  });
});

test('an unknown role rejects the whole call', async () => {
  const outlet = await anOutlet();
  const ann = await addUser('ann');
  const ghost = '00000000-0000-0000-0000-000000000000';
  await expect(service.setStaff(outlet.id, [{ userId: ann.id, roleId: ghost }])).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: `Not a valid role: ${ghost}.`,
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @repo/api exec vitest run src/outlet/outlet.service.test.ts`
Expected: FAIL — type errors on `setStaff`'s argument, then the NOT NULL violation.

- [ ] **Step 7: Implement the service**

In `apps/api/src/outlet/outlet.service.ts`:

Change the schema import to `import { outletStaff, outlets, roles, users, type Outlet } from '../db/schema';` and the rules import to `import { OWNER_ROLE, conflictField, normalizeCode, staffDiff, type StaffEntry } from './outlet-rules';`.

Add `roleId: string;` to `StaffOutput`.

Replace `setStaff` with:

```ts
  /**
   * Replaces the whole roster, roles included. Set semantics keyed on the user, so calling it twice
   * with the same entries is a no-op the second time and the caller never has to diff anything.
   */
  async setStaff(outletId: string, staff: StaffEntry[]): Promise<StaffOutput[]> {
    return this.db.transaction(async (tx) => {
      const [outlet] = await tx
        .select({ id: outlets.id })
        .from(outlets)
        .where(and(eq(outlets.id, outletId), live));
      if (!outlet) throw notFound();

      const userIds = [...new Set(staff.map((s) => s.userId))];
      if (userIds.length) {
        const found = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
        const alive = new Set(found.map((u) => u.id));
        const missing = userIds.find((id) => !alive.has(id));
        // Reject the whole call rather than silently assigning the ids that happened to be real.
        if (missing)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid user: ${missing}.` });
      }

      const roleIds = [...new Set(staff.map((s) => s.roleId))];
      if (roleIds.length) {
        const found = await tx.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIds));
        const known = new Map(found.map((r) => [r.id, r.name]));
        const missing = roleIds.find((id) => !known.has(id));
        if (missing)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a valid role: ${missing}.` });
        // Owner is `users.role_id`, never a membership: handing it out here would be an escalation.
        if ([...known.values()].includes(OWNER_ROLE))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owner is global.' });
      }

      const current = await tx
        .select({ userId: outletStaff.userId, roleId: outletStaff.roleId })
        .from(outletStaff)
        .where(eq(outletStaff.outletId, outletId));
      const { add, remove } = staffDiff(current, staff);

      if (remove.length)
        await tx
          .delete(outletStaff)
          .where(and(eq(outletStaff.outletId, outletId), inArray(outletStaff.userId, remove)));
      if (add.length)
        await tx.insert(outletStaff).values(add.map((s) => ({ outletId, ...s })));

      return this.rosterOf(tx, outletId);
    });
  }
```

(The `onConflictDoNothing` goes: a role change is a delete then an insert of the same key, and a silent conflict would hide a lost update.)

In `rosterOf`, change the select to include the role:

```ts
      .select({ id: users.id, name: users.name, username: users.username, roleId: outletStaff.roleId })
```

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter @repo/api exec vitest run src/outlet/outlet.service.test.ts`
Expected: PASS, all cases including the four new ones.

- [ ] **Step 9: Router**

In `apps/api/src/outlet/outlet.router.ts`:

Add `import { canActOn, type Actor } from '../auth/rbac-rules';` (merging with the Task 5 import) and `import { TRPCError } from '@trpc/server';`. Change the rules import line to also bring `type StaffEntry` from `./outlet-rules`.

Change `staffOutput` to:

```ts
const staffOutput = z.object({ id: z.string(), name: z.string(), username: z.string(), roleId: z.string() });
```

Add above the class:

```ts
/** FORBIDDEN, not NOT_FOUND: hiding the outlet would tell a manager nothing they can act on. */
const wrongOutlet = () => new TRPCError({ code: 'FORBIDDEN', message: 'Wrong outlet.' });
```

Replace the `staff` and `setStaff` procedures with:

```ts
  // Behind staff_assign, not view: a cashier needs the outlet list, not the roster of who else
  // works there. And only for the active outlet unless the role is global.
  @Query({ input: z.object({ outletId: z.uuid() }), output: z.array(staffOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async staff(@Ctx() ctx: Ctx, @Input('outletId') outletId: string) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, outletId)) throw wrongOutlet();
    return this.service.staff(outletId);
  }

  @Mutation({
    input: z.object({
      outletId: z.uuid(),
      staff: z.array(z.object({ userId: z.uuid(), roleId: z.uuid() })).max(200),
    }),
    output: z.array(staffOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async setStaff(@Ctx() ctx: Ctx, @Input() input: { outletId: string; staff: StaffEntry[] }) {
    await this.rbac.require(ctx, 'outlet.staff_assign');
    if (!canActOn(ctx, input.outletId)) throw wrongOutlet();
    return this.service.setStaff(input.outletId, input.staff);
  }
```

- [ ] **Step 10: Verify the API end to end**

Run: `pnpm --filter @repo/api check-types && pnpm --filter @repo/api lint`
Expected: both PASS.

Run: `pnpm trpc:generate`
Expected: `grep -n "staff: z.array" packages/api-contract/src/server.ts` finds the new input.

Run: `pnpm api:test`
Expected: PASS, every file.

Run: `pnpm exec prettier --write apps/api/src apps/api/drizzle/seed`
Expected: only files this plan touched change.

---

### Task 7: Seed stays owner-global

**Files:**
- Modify: `apps/api/drizzle/seed/seed-users.ts:9-13` (comment only)

The seed already sets `users.role_id = owner` for the seeded owner, which is exactly the global-role meaning. No code change is needed; the comment must say so, or the next reader "fixes" it.

- [ ] **Step 1: Update the comment**

Replace the doc comment above `OWNER` with:

```ts
/**
 * The first owner, so a fresh database can be logged into. Dev credentials —
 * change the password before this ever faces a real till. The role goes on `users.role_id`:
 * that is the GLOBAL role, which is why the owner needs no `outlet_staff` row.
 */
```

- [ ] **Step 2: Re-seed and log in**

Run: `pnpm db:seed`
Expected: `users: owner already exists` (or created on a fresh database).

Run (API must be up: `pnpm api:dev` in another terminal):

```sh
curl -s http://localhost:3333/trpc/auth.login -H 'content-type: application/json' -d '{"username":"owner","password":"owner123"}' | head -c 600
```

Expected: JSON containing `"outlets":[…]` with every live outlet and `"outlet":` either the single outlet or `null`.

---

### Task 8: Desktop picker

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/auth.ts`
- Create: `apps/desktop/src/renderer/src/components/outlet-picker.tsx`
- Modify: `apps/desktop/src/renderer/src/app.tsx`

**Interfaces:**
- Consumes: `Session` from `@repo/api-contract` (now with `outlet`/`outlets`); `auth.refresh({ refreshToken, outletId })`.
- Produces: store fields `outlet`, `outlets`, `switching`, and the action `startSwitch()`.

- [ ] **Step 1: Store**

Replace `apps/desktop/src/renderer/src/stores/auth.ts` with:

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RouterOutputs } from '@repo/api-contract';

type Session = RouterOutputs['auth']['login'];

interface AuthState {
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  outlet: Session['outlet'];
  outlets: Session['outlets'];
  // "Show the picker although an outlet is set." Not persisted, and not the same as clearing
  // `outlet`: the token provider's auto-refresh calls setSession, which would put it straight back.
  switching: boolean;
  setSession: (session: Session) => void;
  startSwitch: () => void;
  clear: () => void;
}

const signedOut = { user: null, accessToken: null, refreshToken: null, outlet: null, outlets: [], switching: false };

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set({ user, accessToken, refreshToken, outlet, outlets, switching: false }),
      startSwitch: () => set({ switching: true }),
      clear: () => set(signedOut),
    }),
    {
      name: 'pos-d4-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ user, accessToken, refreshToken, outlet, outlets }) => ({
        user,
        accessToken,
        refreshToken,
        outlet,
        outlets,
      }),
    },
  ),
);
```

- [ ] **Step 2: Picker component**

Create `apps/desktop/src/renderer/src/components/outlet-picker.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { useAuthStore } from '../stores/auth';
import { refreshClient } from '../trpc';

/**
 * Picking an outlet is `auth.refresh` with an `outletId`: the server reissues the session for that
 * outlet. It goes through the link-less refresh client for the same reason the token provider
 * does — the authenticated client would try to refresh on top of it.
 */
export function OutletPicker({ onSignOut }: { onSignOut: () => void }) {
  const { refreshToken, outlets, outlet, setSession } = useAuthStore();

  const pick = useMutation({
    mutationFn: (outletId: string) => refreshClient.auth.refresh.mutate({ refreshToken: refreshToken!, outletId }),
    onSuccess: setSession,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
      <Card className="w-full max-w-md gap-6 p-8">
        <h1 className="text-2xl font-bold text-ink-primary">Pilih outlet</h1>

        {outlets.length === 0 && (
          <Alert variant="warning" role="alert">
            Belum ada outlet untuk akun ini. Minta pemilik menambahkanmu.
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          {outlets.map((o) => (
            <Button
              key={o.id}
              size="lg"
              variant={o.id === outlet?.id ? 'default' : 'outline'}
              className="w-full"
              disabled={pick.isPending}
              onClick={() => pick.mutate(o.id)}
            >
              {o.name}
            </Button>
          ))}
        </div>

        {pick.error && (
          <Alert variant="danger" role="alert">
            {pick.error.message}
          </Alert>
        )}

        <Button variant="ghost" onClick={onSignOut}>
          Keluar
        </Button>
      </Card>
    </div>
  );
}
```

In `apps/desktop/src/renderer/src/trpc.ts`, change `const refreshClient` to `export const refreshClient`.

- [ ] **Step 3: App branches and the header**

In `apps/desktop/src/renderer/src/app.tsx`:

Add `import { OutletPicker } from './components/outlet-picker';`.

In `Home`, replace the `<h1>` and the name line with:

```tsx
      <h1>POS D4</h1>
      <p>
        {me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}
        {outlet && (
          <>
            {' · '}
            {outlet.name}{' '}
            <button type="button" onClick={startSwitch}>
              Ganti outlet
            </button>
          </>
        )}
      </p>
```

and add at the top of `Home`:

```tsx
  const { outlet, startSwitch } = useAuthStore();
```

Replace `App` with:

```tsx
export function App() {
  const { accessToken, outlet, switching } = useAuthStore();
  if (!accessToken) return <LoginForm />;
  if (!outlet || switching) return <OutletPicker onSignOut={signOut} />;
  return <Home />;
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @repo/desktop check-types && pnpm --filter @repo/desktop lint`
Expected: both PASS.

Run: `pnpm exec prettier --write apps/desktop/src/renderer/src`

Manual, with `pnpm api:dev` and `pnpm desktop:dev` running and at least two outlets seeded through `outlet.create` as owner:
1. Log in as `owner` → picker lists every outlet → pick one → home shows its name.
2. "Ganti outlet" → picker again, current one highlighted → pick another → name changes.
3. Wait past the 15-minute access TTL (or set `JWT_ACCESS_TTL=20s` in `apps/api/.env`) → auto-refresh keeps the chosen outlet.
4. `localStorage.clear()` in devtools, reload → login screen.

---

### Task 9: Mobile picker

**Files:**
- Modify: `apps/mobile/src/lib/stores/auth.ts`
- Create: `apps/mobile/src/app/outlet.tsx`
- Modify: `apps/mobile/src/app/index.tsx`

**Interfaces:**
- Consumes: `Session` with `outlet`/`outlets`; `auth.refresh({ refreshToken, outletId })`.
- Produces: store fields `outlet`, `outlets`, `switching`; action `startSwitch()`.

- [ ] **Step 1: Store**

In `apps/mobile/src/lib/stores/auth.ts`:

Add to `AuthState`, after `refreshToken`:

```ts
  outlet: Session['outlet'];
  outlets: Session['outlets'];
  // "Show the picker although an outlet is set." Not persisted; see desktop's store for why it is
  // a flag and not a cleared `outlet`.
  switching: boolean;
  startSwitch: () => void;
```

Initial values, after `refreshToken: null,`: `outlet: null, outlets: [], switching: false, startSwitch: () => set({ switching: true }),`.

Change `setSession` to:

```ts
      setSession: ({ user, accessToken, refreshToken, outlet, outlets }) =>
        set((state) => ({
          user,
          accessToken,
          refreshToken,
          outlet,
          outlets,
          switching: false,
          profiles: { ...state.profiles, [user.id]: { user, refreshToken } },
        })),
```

Change `park` and `clear` to also reset the outlet: `set({ user: null, accessToken: null, refreshToken: null, outlet: null, outlets: [], switching: false })` in both.

Add `outlet` and `outlets` to `partialize`.

`rememberRotation` is unchanged: it only updates the profile's token.

- [ ] **Step 2: Picker screen**

Create `apps/mobile/src/app/outlet.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { refreshClient } from '@/lib/trpc';

/** Picking an outlet is `auth.refresh` with an `outletId`; the server reissues the session for it. */
export default function OutletScreen() {
  const router = useRouter();
  const { accessToken, hydrated, refreshToken, outlets, outlet, setSession } = useAuthStore();

  const pick = useMutation({
    mutationFn: (outletId: string) => refreshClient.auth.refresh.mutate({ refreshToken: refreshToken!, outletId }),
    // `index.tsx` redirected here with `replace`, so there is no back stack to pop; go home explicitly.
    onSuccess: (session) => {
      setSession(session);
      router.replace('/');
    },
  });

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <ScrollView contentContainerClassName="flex-grow justify-center p-6">
        <View className="w-full max-w-md self-center gap-6 rounded-3xl bg-surface p-6">
          <Text className="font-poppins-bold text-2xl text-ink-primary">Pilih outlet</Text>

          {outlets.length === 0 && (
            <Alert variant="warning">Belum ada outlet untuk akun ini. Minta pemilik menambahkanmu.</Alert>
          )}

          <View className="gap-3">
            {outlets.map((o) => (
              <Button
                key={o.id}
                testID={`outlet-${o.id}`}
                size="lg"
                variant={o.id === outlet?.id ? 'default' : 'outline'}
                disabled={pick.isPending}
                onPress={() => pick.mutate(o.id)}
              >
                {o.name}
              </Button>
            ))}
          </View>

          {pick.error && <Alert variant="danger">{pick.error.message}</Alert>}

          <Button variant="ghost" onPress={park}>
            Keluar
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

In `apps/mobile/src/lib/trpc.ts`, change `const refreshClient` to `export const refreshClient`.

- [ ] **Step 3: Route into it**

In `apps/mobile/src/app/index.tsx`:

Change the store line to `const { user, accessToken, hydrated, outlet, switching, startSwitch } = useAuthStore();` and add, after the `/set-pin` redirect:

```tsx
  // No outlet means no role, so nothing below would be allowed anyway. Pick first.
  if (!outlet || switching) return <Redirect href="/outlet" />;
```

After the `<Text>` showing the name, add:

```tsx
        <Text>{outlet.name}</Text>
        <Button title="Ganti outlet" onPress={startSwitch} />
```

`setSession` clears `switching`, and the picker's `router.replace('/')` lands on home.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @repo/mobile check-types && pnpm --filter @repo/mobile lint`
Expected: both PASS.

Run: `pnpm exec prettier --write apps/mobile/src`

Manual, with `pnpm api:dev` and `pnpm mobile:dev` (a user assigned to two outlets, with a PIN):
1. Password login → picker → pick → home shows the outlet name.
2. Sign out (park) → profiles → PIN → home directly, same outlet (carried on the parked row).
3. "Ganti outlet" → picker → pick the other → home.
4. A user with exactly one outlet never sees the picker.

---

### Task 10: Docs and final sweep

**Files:**
- Modify: `CLAUDE.md` (Auth section), `README.md` (error-code table)

- [ ] **Step 1: CLAUDE.md**

In the `### Auth` section of `CLAUDE.md`, append a paragraph:

```markdown
A session carries an **active outlet** (`outletId` in the JWT and on the `refresh_tokens` row). Roles are per outlet (`outlet_staff.role_id`); `users.role_id` is the *global* role, owner only, needing no membership. `auth.refresh` with an `outletId` is the outlet picker — there is no `selectOutlet`. `rbac.require(ctx, permission)` reads the role for `ctx.outletId`; `canActOn(ctx, outletId)` confines a non-global user to their active outlet. Refusals are `FORBIDDEN`: `Not assigned to this outlet.`, `Wrong outlet.`; `setStaff` with the owner role is `BAD_REQUEST` `Owner is global.`
```

- [ ] **Step 2: README.md**

In the error-code table in `README.md` add three rows in the same column format as the existing ones:

```markdown
| `FORBIDDEN` `Not assigned to this outlet.` on `auth.refresh` | the picked outlet is not one of the user's | picker shows the message; session stays |
| `FORBIDDEN` `Wrong outlet.` on `outlet.staff` / `outlet.setStaff` | a non-owner targeted an outlet other than the active one | show the message; switch outlet first |
| `BAD_REQUEST` `Owner is global.` on `outlet.setStaff` | the owner role was put on a roster | show the message |
```

- [ ] **Step 3: Whole-repo verification**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: all green. (`pnpm test` needs Postgres.)

Run: `git status --short`
Expected: only the files in the File Structure table plus the regenerated `server.ts`, the new migration and its `meta` files, `CLAUDE.md`, `README.md`. Nothing committed.
