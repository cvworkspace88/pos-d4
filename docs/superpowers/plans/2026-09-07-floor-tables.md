# Floor Tables, Merge, Reservations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tables become database rows with a drag-and-drop floor layout on desktop and tablet, direct merge/unmerge into groups, minimal reservations, and one permission per action.

**Architecture:** A `tables` row carries its own `x, y, w, h` in a virtual 1000×1000 canvas that each client scales to its viewport; a merge group is `merged_into_id` on member rows pointing at the head. A new Nest `FloorModule` exposes `table` and `reservation` tRPC routers guarded inline by `RbacService.require`. Pure rule and geometry functions live in decorator-free modules so `node --test` covers them; desktop drags with native pointer events, tablet with `react-native-gesture-handler` + reanimated.

**Tech Stack:** NestJS 11 + nestjs-trpc 2.13 + drizzle-orm 0.45 (Postgres), zod 4, React 19 (Electron renderer, react-hook-form), Expo 57 / React Native 0.86 (expo-router, react-native-gesture-handler 2.32, react-native-reanimated 4.5, react-native-worklets 0.10), Node 22 `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-07-floor-tables-design.md`

## Global Constraints

- **No git commits, no branches, no worktrees.** User rule for this project. Leave every change uncommitted on the current branch. Tasks end with lint / type-check / test, never with `git commit`.
- Permission names are dotted `domain.action` strings; code checks the string, never the id.
- Every protected procedure: `@UseMiddlewares(ProtectedMiddleware)` plus `await this.rbac.require(ctx.user.id, '<permission>')` as the first line of the handler. `FORBIDDEN` for a missing permission, never `UNAUTHORIZED`.
- Zod schemas inside `@Router` classes must be inline literals or top-level `const` zod schemas in the same file. The nestjs-trpc generator inlines schema-to-schema references but cannot hoist a non-zod identifier (a regex const, an imported number). Never use `.omit()`, `.merge()` or `.refine()` in router schemas; do those checks in the service.
- Pure modules meant for `node --test` (rules, geometry) contain no decorators, no `enum`, no parameter properties, and import siblings with an explicit `.ts` extension. Node strips types; it does not compile.
- Virtual canvas: `x, y` int 0–1000, `w, h` int 40–500. `name` 1–20 chars, `seats` 1–50, `shape` `rect | round`. `customerName` 1–80, `phone` ≤ 32, `partySize` 1–100, `note` ≤ 500, `startsAt` ISO datetime with offset.
- Error messages are exact strings: `Table name already in use.`, `Unmerge first.`, `Has a booked reservation.`, `Reservation is closed.`, `Table not found.`, `Reservation not found.`
- Dates cross the wire as ISO strings. Output schemas use `z.string()` for `startsAt`; services call `.toISOString()`.
- Lint runs with `--max-warnings 0`; an unused variable fails the build.
- Run `pnpm trpc:generate` after any router change; never edit `packages/api-contract/src/server.ts` by hand.
- Dev prerequisites: `docker compose up -d`, `apps/api/.env` present, API on `:3333`, seeded owner `owner / owner123`.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/api/src/db/schema.ts` (modify) | `tables`, `reservations` tables + types |
| `apps/api/drizzle/0001_*.sql` (generated) | migration |
| `apps/api/drizzle/seed/seed-rbac.ts` (modify) | permission set, prune step |
| `apps/api/drizzle/seed/seed-rbac.test.ts` (modify) | new permission assertions |
| `apps/api/src/floor/floor-rules.ts` (create) | pure merge / delete rules |
| `apps/api/src/floor/floor-rules.test.ts` (create) | rule tests |
| `apps/api/src/floor/table.service.ts` (create) | table queries, transactions |
| `apps/api/src/floor/table.router.ts` (create) | `table.*` procedures + zod |
| `apps/api/src/floor/reservation.service.ts` (create) | reservation queries |
| `apps/api/src/floor/reservation.router.ts` (create) | `reservation.*` procedures + zod |
| `apps/api/src/floor/floor.module.ts` (create) | Nest wiring |
| `apps/api/src/app.module.ts` (modify) | register `FloorModule` |
| `apps/api/package.json` (modify) | add test file |
| `README.md` (modify) | error-code rows |
| `packages/api-contract/src/floor.ts` (create) | shared geometry, groups, badge, day helpers |
| `packages/api-contract/src/floor.test.ts` (create) | tests |
| `packages/api-contract/src/index.ts` (modify) | exports |
| `packages/api-contract/package.json` (modify) | add test file |
| `apps/desktop/src/renderer/src/components/floor-plan.tsx` (create) | canvas, drag, modes, merge picking |
| `apps/desktop/src/renderer/src/components/table-form.tsx` (create) | create / edit / delete dialog |
| `apps/desktop/src/renderer/src/components/reservation-form.tsx` (create) | create reservation dialog |
| `apps/desktop/src/renderer/src/components/reservation-list.tsx` (create) | today's list + status buttons |
| `apps/desktop/src/renderer/src/app.tsx` (modify) | mount `FloorPlan` |
| `apps/mobile/src/app/floor.tsx` (create) | tablet floor screen |
| `apps/mobile/src/components/floor-table.tsx` (create) | one draggable table |
| `apps/mobile/src/components/table-form.tsx` (create) | create / edit / delete modal |
| `apps/mobile/src/components/reservation-form.tsx` (create) | create reservation modal |
| `apps/mobile/src/app/_layout.tsx` (modify) | `GestureHandlerRootView` |
| `apps/mobile/src/app/index.tsx` (modify) | Floor button |

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generated: `apps/api/drizzle/0001_*.sql`, `apps/api/drizzle/meta/*`

**Interfaces:**
- Produces: drizzle tables `tables`, `reservations`; types `Table`, `Reservation` (`$inferSelect`). `tables.shape` is `'rect' | 'round'`; `reservations.status` is `'booked' | 'seated' | 'cancelled' | 'no_show'`.

- [ ] **Step 1: Add the `AnyPgColumn` import**

In `apps/api/src/db/schema.ts`, change the `drizzle-orm/pg-core` import to:

```ts
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Append the two tables at the end of the file**

```ts
export const tables = pgTable(
  'tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    seats: integer('seats').notNull().default(4),
    shape: text('shape').$type<'rect' | 'round'>().notNull().default('rect'),
    // Virtual floor canvas 1000×1000 units; clients scale uniformly to their viewport.
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    w: integer('w').notNull().default(100),
    h: integer('h').notNull().default(100),
    // Set on members of a merge group, pointing at the head. Null = standalone or head. The head
    // carries no marker: it is a head because rows point at it.
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => tables.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Soft delete: future orders and today's reservations keep pointing at a real row.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // A deleted "T3" can be recreated; only live names must be unique.
    uniqueIndex('tables_name_active_idx').on(table.name).where(sql`${table.deletedAt} IS NULL`),
    index('tables_merged_into_id_idx').on(table.mergedIntoId),
  ],
);

export type Table = typeof tables.$inferSelect;

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict on delete: tables are soft-deleted, so this FK is never hit.
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    partySize: integer('party_size').notNull(),
    // The reservation time: date + clock time, timezone-aware. No end time.
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    note: text('note'),
    status: text('status')
      .$type<'booked' | 'seated' | 'cancelled' | 'no_show'>()
      .notNull()
      .default('booked'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('reservations_table_starts_idx').on(table.tableId, table.startsAt)],
);

export type Reservation = typeof reservations.$inferSelect;
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/api check-types`
Expected: exit 0.

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `apps/api/drizzle/0001_<name>.sql`. Verify: `grep -c 'CREATE TABLE' apps/api/drizzle/0001_*.sql` prints `2`, and `grep -c 'tables_name_active_idx' apps/api/drizzle/0001_*.sql` prints `1`.

- [ ] **Step 5: Apply it**

Run: `pnpm db:migrate`
Expected: output ends without error. Verify with `docker compose exec -T db psql -U postgres -c '\d tables'` (adjust user/db to `apps/api/.env`) that columns `x, y, w, h, merged_into_id, deleted_at` exist. If `docker compose exec` is not usable, `pnpm --filter @repo/api db:studio` shows both tables.

---

### Task 2: Permission set and seed prune

**Files:**
- Modify: `apps/api/drizzle/seed/seed-rbac.ts`
- Test: `apps/api/drizzle/seed/seed-rbac.test.ts`

**Interfaces:**
- Produces: permission names `table.view`, `table.create`, `table.delete`, `table.layout_manage`, `table.merge`, `reservation.view`, `reservation.create`, `reservation.update`. `table.merge_request` and `table.merge_approve` no longer exist.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/drizzle/seed/seed-rbac.test.ts`:

```ts
test('table.merge is a direct floor action held by waiter and cashier', () => {
  assert.deepEqual(holdersOf('table.merge'), ['owner', 'manager', 'waiter', 'cashier']);
});

test('the request/approve merge pair is gone', () => {
  assert.equal('table.merge_request' in PERMISSIONS, false);
  assert.equal('table.merge_approve' in PERMISSIONS, false);
});

test('table lifecycle and layout are manager and owner only', () => {
  for (const permission of ['table.create', 'table.delete', 'table.layout_manage'])
    assert.deepEqual(holdersOf(permission), ['owner', 'manager'], permission);
});

test('reservations are floor-staff work', () => {
  for (const permission of ['reservation.view', 'reservation.create', 'reservation.update'])
    assert.deepEqual(holdersOf(permission), ['owner', 'manager', 'waiter', 'cashier'], permission);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && node --test drizzle/seed/seed-rbac.test.ts`
Expected: 4 failing tests. `table.merge` holders come back `['owner', 'manager']` (unknown permission falls back to owner/manager) and `table.merge_request in PERMISSIONS` is `true`.

- [ ] **Step 3: Edit the permission map**

In `apps/api/drizzle/seed/seed-rbac.ts`, replace the `table.*` block inside `PERMISSIONS`:

```ts
  'table.view': ['waiter', 'cashier'],
  'table.create': [],
  'table.delete': [],
  // Move, resize, rename, seats, shape.
  'table.layout_manage': [],
  'table.assign': ['waiter', 'cashier'],
  'table.transfer_request': ['waiter', 'cashier'],
  'table.transfer_approve': [],
  // Direct: join tables into a group for a big party and split them again. No approval step.
  'table.merge': ['waiter', 'cashier'],
  'table.close': ['waiter', 'cashier'],
  'table.force_close_request': ['waiter', 'cashier'],
  'table.force_close_approve': [],
  'table.reopen_request': ['waiter', 'cashier'],
  'table.reopen_approve': [],

  'reservation.view': ['waiter', 'cashier'],
  'reservation.create': ['waiter', 'cashier'],
  // Seat, no-show, cancel, edit while still booked.
  'reservation.update': ['waiter', 'cashier'],
```

(`table.merge_request`, `table.merge_approve` and the old `table.layout_manage` line are removed; everything else in the map is untouched.)

- [ ] **Step 4: Add the prune step**

Change the drizzle import at the top of `seed-rbac.ts`:

```ts
import { notInArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
```

In `seedRbac`, right after the `permissions` insert and before the `roleId` map:

```ts
  // The seed is the source of truth: a permission dropped from PERMISSIONS leaves the database on
  // the next run, and its role_permissions rows go with it through the FK cascade. Roles are never
  // pruned — a user may still point at one.
  await db.delete(permissions).where(notInArray(permissions.name, Object.keys(PERMISSIONS)));
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && node --test drizzle/seed/seed-rbac.test.ts`
Expected: all pass.

- [ ] **Step 6: Re-seed and type-check**

Run: `pnpm db:seed && pnpm --filter @repo/api check-types`
Expected: log line `rbac: 6 roles, <N> permissions, <M> grants`; exit 0. Then `curl` is not needed: `pnpm --filter @repo/api db:studio` or psql shows no `table.merge_request` row in `permissions`.

---

### Task 3: Pure floor rules

**Files:**
- Create: `apps/api/src/floor/floor-rules.ts`
- Test: `apps/api/src/floor/floor-rules.test.ts`
- Modify: `apps/api/package.json` (test script)

**Interfaces:**
- Produces:
  - `interface RuleTable { id: string; mergedIntoId: string | null }`
  - `interface RuleReservation { tableId: string; status: string }`
  - `const UNMERGE_FIRST = 'Unmerge first.'`, `const HAS_BOOKED = 'Has a booked reservation.'`
  - `rejectMerge(head: RuleTable, members: RuleTable[], tables: RuleTable[]): string | null`
  - `rejectDelete(table: RuleTable, tables: RuleTable[], reservations: RuleReservation[]): string | null`
- Callers pass only live tables. Existence (`NOT_FOUND`) is the service's job and happens before these run.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/floor/floor-rules.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { HAS_BOOKED, UNMERGE_FIRST, rejectDelete, rejectMerge } from './floor-rules.ts';

const t = (id: string, mergedIntoId: string | null = null) => ({ id, mergedIntoId });

// A: standalone. B: standalone. H: head of {M}. M: member of H.
const A = t('A');
const B = t('B');
const H = t('H');
const M = t('M', 'H');
const ALL = [A, B, H, M];

test('two standalone tables can merge', () => {
  assert.equal(rejectMerge(A, [B], ALL), null);
});

test('an existing head can take another standalone member', () => {
  assert.equal(rejectMerge(H, [A], ALL), null);
});

test('a member cannot be a head', () => {
  assert.equal(rejectMerge(M, [A], ALL), UNMERGE_FIRST);
});

test('a member cannot join another group', () => {
  assert.equal(rejectMerge(A, [M], ALL), UNMERGE_FIRST);
});

test('a head cannot become a member — one level only', () => {
  assert.equal(rejectMerge(A, [H], ALL), UNMERGE_FIRST);
});

test('one bad member rejects the whole merge', () => {
  assert.equal(rejectMerge(A, [B, M], ALL), UNMERGE_FIRST);
});

test('a standalone table with no booked reservation can be deleted', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'A', status: 'seated' }]), null);
});

test('a head cannot be deleted', () => {
  assert.equal(rejectDelete(H, ALL, []), UNMERGE_FIRST);
});

test('a member cannot be deleted', () => {
  assert.equal(rejectDelete(M, ALL, []), UNMERGE_FIRST);
});

test('a booked reservation blocks delete', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'A', status: 'booked' }]), HAS_BOOKED);
});

test('a booked reservation on another table does not', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'B', status: 'booked' }]), null);
});

test('merge wins over reservation when both block', () => {
  assert.equal(rejectDelete(M, ALL, [{ tableId: 'M', status: 'booked' }]), UNMERGE_FIRST);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && node --test src/floor/floor-rules.test.ts`
Expected: fails with `Cannot find module '.../floor-rules.ts'`.

- [ ] **Step 3: Implement**

Create `apps/api/src/floor/floor-rules.ts`:

```ts
export interface RuleTable {
  id: string;
  mergedIntoId: string | null;
}

export interface RuleReservation {
  tableId: string;
  status: string;
}

export const UNMERGE_FIRST = 'Unmerge first.';
export const HAS_BOOKED = 'Has a booked reservation.';

const isHead = (id: string, tables: RuleTable[]) => tables.some((t) => t.mergedIntoId === id);

/**
 * Why `members` cannot be merged into `head`, or null if they can. `tables` is every live table.
 *
 * Groups are one level deep: a head may already have members (the group grows), but a member can
 * be neither head nor member of anything else, and a head cannot become a member. That keeps
 * `unmerge` a single UPDATE with no cascade.
 *
 * Pure and decorator-free so `node --test` can import it — same reason `pin-policy.ts` exists.
 */
export function rejectMerge(head: RuleTable, members: RuleTable[], tables: RuleTable[]): string | null {
  if (head.mergedIntoId) return UNMERGE_FIRST;
  for (const member of members) {
    if (member.mergedIntoId || isHead(member.id, tables)) return UNMERGE_FIRST;
  }
  return null;
}

/** Why `table` cannot be soft-deleted, or null. Merge membership is checked before reservations. */
export function rejectDelete(
  table: RuleTable,
  tables: RuleTable[],
  reservations: RuleReservation[],
): string | null {
  if (table.mergedIntoId || isHead(table.id, tables)) return UNMERGE_FIRST;
  if (reservations.some((r) => r.tableId === table.id && r.status === 'booked')) return HAS_BOOKED;
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && node --test src/floor/floor-rules.test.ts`
Expected: 12 passing.

- [ ] **Step 5: Register the test file**

In `apps/api/package.json`, change the `test` script to:

```json
"test": "node --test src/auth/refresh-window.test.ts src/auth/pin-policy.test.ts src/trpc/error-formatter.test.ts src/floor/floor-rules.test.ts drizzle/seed/seed-rbac.test.ts",
```

Run: `pnpm --filter @repo/api test`
Expected: all files pass.

---

### Task 4: `table` service, router and `FloorModule`

**Files:**
- Create: `apps/api/src/floor/table.service.ts`
- Create: `apps/api/src/floor/table.router.ts`
- Create: `apps/api/src/floor/floor.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Generated: `packages/api-contract/src/server.ts`

**Interfaces:**
- Consumes: `rejectMerge`, `rejectDelete` (Task 3); `tables`, `reservations`, `Table` (Task 1); `RbacService.require`, `ProtectedMiddleware`, `PublicUser` (existing).
- Produces tRPC procedures under `table`:
  - `list(): TableOutput[]`
  - `create({ name, seats, shape, x, y, w, h }): TableOutput`
  - `update({ id, name, seats, shape }): TableOutput` — all three fields required (the form always sends them; an all-optional patch invites an empty UPDATE)
  - `updateLayout({ items: { id, x, y, w, h }[] }): TableOutput[]` — only the updated rows
  - `delete({ id }): { success: boolean }`
  - `merge({ headId, memberIds }): TableOutput[]` — full live list after
  - `unmerge({ id }): TableOutput[]` — full live list after
  - `TableOutput = { id, name, seats, shape, x, y, w, h, mergedIntoId }`
- Exports `TableService` class and `tableOutput(row)` mapper.

- [ ] **Step 1: Write the service**

Create `apps/api/src/floor/table.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { reservations, tables, type Table } from '../db/schema';
import { rejectDelete, rejectMerge } from './floor-rules';

export interface TableInput {
  name: string;
  seats: number;
  shape: 'rect' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What clients see of a table. Timestamps and `deletedAt` stay server-side. */
export const tableOutput = (t: Table) => ({
  id: t.id,
  name: t.name,
  seats: t.seats,
  shape: t.shape,
  x: t.x,
  y: t.y,
  w: t.w,
  h: t.h,
  mergedIntoId: t.mergedIntoId,
});
export type TableOutput = ReturnType<typeof tableOutput>;

const live = isNull(tables.deletedAt);

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });

/** Postgres unique violation. drizzle ≥ 0.44 wraps driver errors, so look at `cause` too. */
const isUniqueViolation = (error: unknown): boolean => {
  const direct = (error as { code?: string }).code;
  const nested = (error as { cause?: { code?: string } }).cause?.code;
  return direct === '23505' || nested === '23505';
};

@Injectable()
export class TableService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(): Promise<TableOutput[]> {
    const rows = await this.db.select().from(tables).where(live).orderBy(tables.name);
    return rows.map(tableOutput);
  }

  async create(input: TableInput): Promise<TableOutput> {
    try {
      const [row] = await this.db.insert(tables).values(input).returning();
      return tableOutput(row!);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use.' });
      throw error;
    }
  }

  async update(id: string, patch: Pick<TableInput, 'name' | 'seats' | 'shape'>): Promise<TableOutput> {
    await this.find(id);
    try {
      const [row] = await this.db
        .update(tables)
        .set(patch)
        .where(and(eq(tables.id, id), live))
        .returning();
      return tableOutput(row!);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use.' });
      throw error;
    }
  }

  /** One transaction: a stale id anywhere in the batch rolls back every move. */
  async updateLayout(items: LayoutItem[]): Promise<TableOutput[]> {
    return this.db.transaction(async (tx) => {
      const out: TableOutput[] = [];
      for (const { id, ...position } of items) {
        const [row] = await tx
          .update(tables)
          .set(position)
          .where(and(eq(tables.id, id), live))
          .returning();
        if (!row) throw notFound();
        out.push(tableOutput(row));
      }
      return out;
    });
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const table = await this.find(id);
    const all = await this.db
      .select({ id: tables.id, mergedIntoId: tables.mergedIntoId })
      .from(tables)
      .where(live);
    const onTable = await this.db
      .select({ tableId: reservations.tableId, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.tableId, id));
    const reason = rejectDelete(table, all, onTable);
    if (reason) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: reason });

    await this.db.update(tables).set({ deletedAt: new Date() }).where(eq(tables.id, id));
    return { success: true };
  }

  async merge(headId: string, memberIds: string[]): Promise<TableOutput[]> {
    if (memberIds.includes(headId))
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A table cannot merge into itself.' });

    return this.db.transaction(async (tx) => {
      const all = await tx.select().from(tables).where(live);
      const byId = new Map(all.map((t) => [t.id, t]));
      const head = byId.get(headId);
      const members = memberIds.map((id) => byId.get(id));
      if (!head || members.some((m) => m === undefined)) throw notFound();

      const reason = rejectMerge(head, members as Table[], all);
      if (reason) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: reason });

      await tx.update(tables).set({ mergedIntoId: headId }).where(inArray(tables.id, memberIds));
      const rows = await tx.select().from(tables).where(live).orderBy(tables.name);
      return rows.map(tableOutput);
    });
  }

  /** On a head the whole group dissolves; on a member only that row leaves; standalone is a no-op. */
  async unmerge(id: string): Promise<TableOutput[]> {
    const table = await this.find(id);
    const target = table.mergedIntoId ? eq(tables.id, id) : eq(tables.mergedIntoId, id);
    await this.db.update(tables).set({ mergedIntoId: null }).where(target);
    return this.list();
  }

  private async find(id: string): Promise<Table> {
    const [row] = await this.db
      .select()
      .from(tables)
      .where(and(eq(tables.id, id), live));
    if (!row) throw notFound();
    return row;
  }
}
```

- [ ] **Step 2: Write the router**

Create `apps/api/src/floor/table.router.ts`:

```ts
import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import { TableService, type LayoutItem, type TableInput } from './table.service';

type Ctx = { user: PublicUser };

// The generator hoists these into the shared contract. Bounds are literals on purpose: it cannot
// hoist an identifier a schema references.
const tableOutput = z.object({
  id: z.string(),
  name: z.string(),
  seats: z.number(),
  shape: z.enum(['rect', 'round']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  mergedIntoId: z.string().nullable(),
});

const layoutItem = z.object({
  id: z.string(),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(40).max(500),
  h: z.number().int().min(40).max(500),
});

@Router({ alias: 'table' })
export class TableRouter {
  constructor(
    @Inject(TableService) private readonly service: TableService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({ output: z.array(tableOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx) {
    await this.rbac.require(ctx.user.id, 'table.view');
    return this.service.list();
  }

  @Mutation({
    input: z.object({
      name: z.string().trim().min(1).max(20),
      seats: z.number().int().min(1).max(50),
      shape: z.enum(['rect', 'round']),
      x: z.number().int().min(0).max(1000),
      y: z.number().int().min(0).max(1000),
      w: z.number().int().min(40).max(500),
      h: z.number().int().min(40).max(500),
    }),
    output: tableOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: TableInput) {
    await this.rbac.require(ctx.user.id, 'table.create');
    return this.service.create(input);
  }

  @Mutation({
    input: z.object({
      id: z.string(),
      name: z.string().trim().min(1).max(20),
      seats: z.number().int().min(1).max(50),
      shape: z.enum(['rect', 'round']),
    }),
    output: tableOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(
    @Ctx() ctx: Ctx,
    @Input() input: { id: string; name: string; seats: number; shape: 'rect' | 'round' },
  ) {
    await this.rbac.require(ctx.user.id, 'table.layout_manage');
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }

  @Mutation({
    input: z.object({ items: z.array(layoutItem).min(1).max(200) }),
    output: z.array(tableOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async updateLayout(@Ctx() ctx: Ctx, @Input('items') items: LayoutItem[]) {
    await this.rbac.require(ctx.user.id, 'table.layout_manage');
    return this.service.updateLayout(items);
  }

  @Mutation({ input: z.object({ id: z.string() }), output: z.object({ success: z.boolean() }) })
  @UseMiddlewares(ProtectedMiddleware)
  async delete(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx.user.id, 'table.delete');
    return this.service.delete(id);
  }

  @Mutation({
    input: z.object({ headId: z.string(), memberIds: z.array(z.string()).min(1).max(50) }),
    output: z.array(tableOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async merge(@Ctx() ctx: Ctx, @Input() input: { headId: string; memberIds: string[] }) {
    await this.rbac.require(ctx.user.id, 'table.merge');
    return this.service.merge(input.headId, input.memberIds);
  }

  @Mutation({ input: z.object({ id: z.string() }), output: z.array(tableOutput) })
  @UseMiddlewares(ProtectedMiddleware)
  async unmerge(@Ctx() ctx: Ctx, @Input('id') id: string) {
    await this.rbac.require(ctx.user.id, 'table.merge');
    return this.service.unmerge(id);
  }
}
```

- [ ] **Step 3: Write the module and register it**

Create `apps/api/src/floor/floor.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TableRouter } from './table.router';
import { TableService } from './table.service';

@Module({
  imports: [AuthModule],
  providers: [TableService, TableRouter],
})
export class FloorModule {}
```

In `apps/api/src/app.module.ts` add the import and register it after `SettingsModule`:

```ts
import { FloorModule } from './floor/floor.module';
```

```ts
    AuthModule,
    SettingsModule,
    FloorModule,
```

- [ ] **Step 4: Type-check, lint, regenerate the contract**

Run: `pnpm --filter @repo/api check-types && pnpm --filter @repo/api lint && pnpm trpc:generate`
Expected: exit 0; `grep -c 'table: t.router' packages/api-contract/src/server.ts` prints `1`.

- [ ] **Step 5: Smoke-test over HTTP**

Start the API in one terminal: `pnpm --filter @repo/api dev`. In another:

```sh
TOKEN=$(curl -s -X POST localhost:3333/trpc/auth.login -H 'content-type: application/json' \
  -d '{"username":"owner","password":"owner123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).result.data.accessToken')

# create two tables
curl -s -X POST localhost:3333/trpc/table.create -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"T1","seats":4,"shape":"rect","x":50,"y":50,"w":100,"h":100}'
curl -s -X POST localhost:3333/trpc/table.create -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"T2","seats":2,"shape":"round","x":200,"y":50,"w":80,"h":80}'

# duplicate name -> CONFLICT
curl -s -X POST localhost:3333/trpc/table.create -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"T1","seats":4,"shape":"rect","x":0,"y":0,"w":100,"h":100}'

# list
curl -s localhost:3333/trpc/table.list -H "authorization: Bearer $TOKEN"
```

Expected: first two calls return `{"result":{"data":{...}}}` with ids; the third returns `"code":"CONFLICT"` and message `Table name already in use.`; list returns both rows ordered by name.

Then with the two ids from the list (`$T1`, `$T2`):

```sh
curl -s -X POST localhost:3333/trpc/table.merge -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"headId\":\"$T1\",\"memberIds\":[\"$T2\"]}"
curl -s -X POST localhost:3333/trpc/table.delete -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"id\":\"$T2\"}"
curl -s -X POST localhost:3333/trpc/table.unmerge -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"id\":\"$T1\"}"
```

Expected: merge returns the list with T2's `mergedIntoId` = T1's id; delete returns `PRECONDITION_FAILED` `Unmerge first.`; unmerge returns both with `mergedIntoId: null`.

---

### Task 5: `reservation` service and router, README rows

**Files:**
- Create: `apps/api/src/floor/reservation.service.ts`
- Create: `apps/api/src/floor/reservation.router.ts`
- Modify: `apps/api/src/floor/floor.module.ts`
- Modify: `README.md` (error-code table)
- Generated: `packages/api-contract/src/server.ts`

**Interfaces:**
- Consumes: `reservations`, `tables`, `Reservation` (Task 1); `FloorModule` (Task 4).
- Produces tRPC procedures under `reservation`:
  - `list({ from, to }): ReservationOutput[]` — `from`/`to` ISO strings, `[from, to)`, ordered by `startsAt`
  - `create({ tableId, customerName, phone?, partySize, startsAt, note? }): ReservationOutput`
  - `update({ id, status?, customerName?, phone?, partySize?, startsAt?, note?, tableId? }): ReservationOutput`
  - `ReservationOutput = { id, tableId, customerName, phone: string | null, partySize, startsAt: string (ISO), note: string | null, status }`

- [ ] **Step 1: Write the service**

Create `apps/api/src/floor/reservation.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { reservations, tables, type Reservation } from '../db/schema';

export type ReservationStatus = Reservation['status'];

export interface ReservationInput {
  tableId: string;
  customerName: string;
  phone?: string;
  partySize: number;
  /** ISO datetime with offset; stored as timestamptz. */
  startsAt: string;
  note?: string;
}

export type ReservationPatch = Partial<ReservationInput> & { status?: Exclude<ReservationStatus, 'booked'> };

export const reservationOutput = (r: Reservation) => ({
  id: r.id,
  tableId: r.tableId,
  customerName: r.customerName,
  phone: r.phone,
  partySize: r.partySize,
  startsAt: r.startsAt.toISOString(),
  note: r.note,
  status: r.status,
});
export type ReservationOutput = ReturnType<typeof reservationOutput>;

@Injectable()
export class ReservationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(from: string, to: string): Promise<ReservationOutput[]> {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(and(gte(reservations.startsAt, new Date(from)), lt(reservations.startsAt, new Date(to))))
      .orderBy(asc(reservations.startsAt));
    return rows.map(reservationOutput);
  }

  async create(userId: string, input: ReservationInput): Promise<ReservationOutput> {
    await this.requireLiveTable(input.tableId);
    const [row] = await this.db
      .insert(reservations)
      .values({ ...input, startsAt: new Date(input.startsAt), createdBy: userId })
      .returning();
    return reservationOutput(row!);
  }

  /** Only a booked reservation changes. Seated, cancelled and no-show are terminal. */
  async update(id: string, patch: ReservationPatch): Promise<ReservationOutput> {
    const [current] = await this.db.select().from(reservations).where(eq(reservations.id, id));
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reservation not found.' });
    if (current.status !== 'booked')
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Reservation is closed.' });
    if (patch.tableId) await this.requireLiveTable(patch.tableId);

    // drizzle rejects an UPDATE with nothing to set; an empty patch is a no-op read.
    const { startsAt, ...rest } = patch;
    const set = { ...rest, ...(startsAt ? { startsAt: new Date(startsAt) } : {}) };
    if (Object.values(set).every((v) => v === undefined)) return reservationOutput(current);

    const [row] = await this.db.update(reservations).set(set).where(eq(reservations.id, id)).returning();
    return reservationOutput(row!);
  }

  private async requireLiveTable(tableId: string): Promise<void> {
    const [table] = await this.db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });
  }
}
```

- [ ] **Step 2: Write the router**

Create `apps/api/src/floor/reservation.router.ts`:

```ts
import { Inject } from '@nestjs/common';
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service';
import { ProtectedMiddleware } from '../auth/protected.middleware';
import { RbacService } from '../auth/rbac.service';
import {
  ReservationService,
  type ReservationInput,
  type ReservationPatch,
} from './reservation.service';

type Ctx = { user: PublicUser };

const reservationOutput = z.object({
  id: z.string(),
  tableId: z.string(),
  customerName: z.string(),
  phone: z.string().nullable(),
  partySize: z.number(),
  startsAt: z.string(),
  note: z.string().nullable(),
  status: z.enum(['booked', 'seated', 'cancelled', 'no_show']),
});

@Router({ alias: 'reservation' })
export class ReservationRouter {
  constructor(
    @Inject(ReservationService) private readonly service: ReservationService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Query({
    input: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }),
    output: z.array(reservationOutput),
  })
  @UseMiddlewares(ProtectedMiddleware)
  async list(@Ctx() ctx: Ctx, @Input() input: { from: string; to: string }) {
    await this.rbac.require(ctx.user.id, 'reservation.view');
    return this.service.list(input.from, input.to);
  }

  @Mutation({
    input: z.object({
      tableId: z.string(),
      customerName: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100),
      startsAt: z.iso.datetime({ offset: true }),
      note: z.string().trim().max(500).optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async create(@Ctx() ctx: Ctx, @Input() input: ReservationInput) {
    await this.rbac.require(ctx.user.id, 'reservation.create');
    return this.service.create(ctx.user.id, input);
  }

  @Mutation({
    input: z.object({
      id: z.string(),
      status: z.enum(['seated', 'cancelled', 'no_show']).optional(),
      tableId: z.string().optional(),
      customerName: z.string().trim().min(1).max(80).optional(),
      phone: z.string().trim().max(32).optional(),
      partySize: z.number().int().min(1).max(100).optional(),
      startsAt: z.iso.datetime({ offset: true }).optional(),
      note: z.string().trim().max(500).optional(),
    }),
    output: reservationOutput,
  })
  @UseMiddlewares(ProtectedMiddleware)
  async update(@Ctx() ctx: Ctx, @Input() input: { id: string } & ReservationPatch) {
    await this.rbac.require(ctx.user.id, 'reservation.update');
    const { id, ...patch } = input;
    return this.service.update(id, patch);
  }
}
```

- [ ] **Step 3: Register in the module**

`apps/api/src/floor/floor.module.ts` becomes:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReservationRouter } from './reservation.router';
import { ReservationService } from './reservation.service';
import { TableRouter } from './table.router';
import { TableService } from './table.service';

@Module({
  imports: [AuthModule],
  providers: [TableService, TableRouter, ReservationService, ReservationRouter],
})
export class FloorModule {}
```

- [ ] **Step 4: README error rows**

In `README.md`, in the table under `### Error codes: \`UNAUTHORIZED\` vs \`FORBIDDEN\``, append these rows after the last existing row:

```md
| `CONFLICT` on `table.create` / `table.update`             | a live table already has that name                          | keep the form open, show the message                                                             |
| `PRECONDITION_FAILED` on `table.*` / `reservation.update`  | `Unmerge first.`, `Has a booked reservation.`, `Reservation is closed.` — state changed elsewhere | show the message, refetch `table.list` and `reservation.list`                                    |
| `NOT_FOUND` on `table.*` / `reservation.*`                | the table or reservation was deleted on another client      | same as above                                                                                    |
```

- [ ] **Step 5: Type-check, lint, regenerate**

Run: `pnpm --filter @repo/api check-types && pnpm --filter @repo/api lint && pnpm trpc:generate`
Expected: exit 0; `grep -c 'reservation: t.router' packages/api-contract/src/server.ts` prints `1`.

- [ ] **Step 6: Smoke-test over HTTP**

With `$TOKEN` and `$T1` from Task 4 (restart `pnpm --filter @repo/api dev` if it was stopped):

```sh
curl -s -X POST localhost:3333/trpc/reservation.create -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"tableId\":\"$T1\",\"customerName\":\"Tan\",\"partySize\":4,\"startsAt\":\"2026-09-07T19:30:00+08:00\"}"

FROM=$(node -pe 'new Date(new Date().setHours(0,0,0,0)).toISOString()')
TO=$(node -pe 'new Date(new Date().setHours(24,0,0,0)).toISOString()')
curl -s -G localhost:3333/trpc/reservation.list -H "authorization: Bearer $TOKEN" \
  --data-urlencode "input={\"from\":\"$FROM\",\"to\":\"$TO\"}"
```

Expected: create returns `status: "booked"` and `startsAt` as a UTC ISO string; list contains it (if today is not 2026-09-07 use today's date in `startsAt`). Then with its id `$R1`:

```sh
curl -s -X POST localhost:3333/trpc/table.delete -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"id\":\"$T1\"}"
curl -s -X POST localhost:3333/trpc/reservation.update -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"id\":\"$R1\",\"status\":\"seated\"}"
curl -s -X POST localhost:3333/trpc/reservation.update -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"id\":\"$R1\",\"status\":\"cancelled\"}"
```

Expected: delete → `PRECONDITION_FAILED` `Has a booked reservation.`; first update → `status: "seated"`; second → `PRECONDITION_FAILED` `Reservation is closed.`

---

### Task 6: Shared floor helpers in `@repo/api-contract`

**Files:**
- Create: `packages/api-contract/src/floor.ts`
- Test: `packages/api-contract/src/floor.test.ts`
- Modify: `packages/api-contract/src/index.ts`
- Modify: `packages/api-contract/package.json` (test script)

**Interfaces:**
- Produces (all exported from `@repo/api-contract`):
  - `interface FloorTable { id: string; seats: number; w: number; h: number; mergedIntoId: string | null }`
  - `interface FloorReservation { tableId: string; status: string; startsAt: Date | string }`
  - `const FLOOR = { size: 1000, minSide: 40, maxSide: 500 }`
  - `const RESERVED_LEAD_MS = 30 * 60 * 1000`
  - `scaleFor(viewportW: number, viewportH: number): number`
  - `clampPosition(table: { w: number; h: number }, x: number, y: number): { x: number; y: number }` — rounds to int
  - `groupsOf(tables: FloorTable[]): Map<string, string[]>` — head id → member ids
  - `seatsOf(headId: string, tables: FloorTable[]): number`
  - `isReserved(tableId: string, reservations: FloorReservation[], now: Date): boolean`
  - `dayRange(now?: Date): { from: string; to: string }` — local midnight to next local midnight, ISO
  - `nextFullHourLocal(now?: Date): string` — `YYYY-MM-DDTHH:mm` in local time, for `datetime-local` inputs

- [ ] **Step 1: Write the failing tests**

Create `packages/api-contract/src/floor.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLOOR,
  RESERVED_LEAD_MS,
  clampPosition,
  dayRange,
  groupsOf,
  isReserved,
  nextFullHourLocal,
  scaleFor,
  seatsOf,
} from './floor.ts';

const table = (id: string, seats: number, mergedIntoId: string | null = null) => ({
  id,
  seats,
  w: 100,
  h: 100,
  mergedIntoId,
});

test('scale is uniform and follows the shorter side', () => {
  assert.equal(scaleFor(500, 1000), 0.5);
  assert.equal(scaleFor(1000, 250), 0.25);
  assert.equal(scaleFor(0, 0), 0);
});

test('clamp keeps the whole table inside the canvas and rounds', () => {
  const t = { w: 100, h: 50 };
  assert.deepEqual(clampPosition(t, -5, -5), { x: 0, y: 0 });
  assert.deepEqual(clampPosition(t, 950, 980), { x: FLOOR.size - 100, y: FLOOR.size - 50 });
  assert.deepEqual(clampPosition(t, 10.4, 10.6), { x: 10, y: 11 });
});

test('groupsOf maps a head to its members and ignores standalone tables', () => {
  const groups = groupsOf([table('H', 4), table('A', 2, 'H'), table('B', 2, 'H'), table('S', 6)]);
  assert.deepEqual([...groups.entries()], [['H', ['A', 'B']]]);
});

test('seatsOf sums the head and its members, a member counts only itself', () => {
  const tables = [table('H', 4), table('A', 2, 'H'), table('B', 2, 'H'), table('S', 6)];
  assert.equal(seatsOf('H', tables), 8);
  assert.equal(seatsOf('A', tables), 2);
  assert.equal(seatsOf('S', tables), 6);
});

const NOW = new Date(Date.UTC(2026, 8, 7, 12, 0, 0));
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

test('reserved from 30 minutes before the booking', () => {
  const soon = [{ tableId: 'T', status: 'booked', startsAt: at(29 * 60 * 1000) }];
  const later = [{ tableId: 'T', status: 'booked', startsAt: at(31 * 60 * 1000) }];
  assert.equal(isReserved('T', soon, NOW), true);
  assert.equal(isReserved('T', later, NOW), false);
  assert.equal(RESERVED_LEAD_MS, 30 * 60 * 1000);
});

test('a booking already past its time still shows until staff resolve it', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'booked', startsAt: at(-60 * 60 * 1000) }], NOW), true);
});

test('seated, cancelled and no-show bookings and other tables do not count', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'seated', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'cancelled', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'no_show', startsAt: at(0) }], NOW), false);
  assert.equal(isReserved('T', [{ tableId: 'U', status: 'booked', startsAt: at(0) }], NOW), false);
});

test('isReserved accepts Date as well as ISO string', () => {
  assert.equal(isReserved('T', [{ tableId: 'T', status: 'booked', startsAt: NOW }], NOW), true);
});

test('dayRange spans local midnight to the next one', () => {
  const now = new Date(2026, 8, 7, 15, 45); // local time
  const { from, to } = dayRange(now);
  assert.equal(new Date(from).getHours(), 0);
  assert.equal(new Date(from).getDate(), 7);
  assert.equal(new Date(to).getDate(), 8);
  assert.equal(new Date(to).getHours(), 0);
});

test('nextFullHourLocal formats the next full hour for a datetime-local input', () => {
  assert.equal(nextFullHourLocal(new Date(2026, 8, 7, 15, 45)), '2026-09-07T16:00');
  assert.equal(nextFullHourLocal(new Date(2026, 8, 7, 23, 10)), '2026-09-08T00:00');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/api-contract && node --test src/floor.test.ts`
Expected: fails with `Cannot find module '.../floor.ts'`.

- [ ] **Step 3: Implement**

Create `packages/api-contract/src/floor.ts`:

```ts
/**
 * Floor geometry and derived state shared by desktop and tablet. Pure so `node --test` can import
 * it — same reason `refresh.ts` lives in this package.
 *
 * Structural types on purpose: `table.list` and `reservation.list` rows satisfy them, but this
 * module never imports the generated router.
 */
export interface FloorTable {
  id: string;
  seats: number;
  w: number;
  h: number;
  mergedIntoId: string | null;
}

export interface FloorReservation {
  tableId: string;
  status: string;
  startsAt: Date | string;
}

/** Virtual canvas in table units. Both clients scale it uniformly, so a table lands in the same place on each. */
export const FLOOR = { size: 1000, minSide: 40, maxSide: 500 } as const;

/** A table reads "Reserved" this long before its booking. */
export const RESERVED_LEAD_MS = 30 * 60 * 1000;

export function scaleFor(viewportW: number, viewportH: number): number {
  return Math.max(0, Math.min(viewportW, viewportH)) / FLOOR.size;
}

export function clampPosition(table: { w: number; h: number }, x: number, y: number): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max);
  return { x: clamp(x, FLOOR.size - table.w), y: clamp(y, FLOOR.size - table.h) };
}

/** head id -> member ids. A table with nobody pointing at it is absent. */
export function groupsOf(tables: FloorTable[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const table of tables) {
    if (!table.mergedIntoId) continue;
    const members = groups.get(table.mergedIntoId) ?? [];
    members.push(table.id);
    groups.set(table.mergedIntoId, members);
  }
  return groups;
}

/** Seats of the table plus everything merged into it. For a member or standalone table: its own seats. */
export function seatsOf(headId: string, tables: FloorTable[]): number {
  return tables
    .filter((t) => t.id === headId || t.mergedIntoId === headId)
    .reduce((sum, t) => sum + t.seats, 0);
}

/** True while a booked reservation is due within `RESERVED_LEAD_MS`, or overdue and not yet resolved. */
export function isReserved(tableId: string, reservations: FloorReservation[], now: Date): boolean {
  const limit = now.getTime() + RESERVED_LEAD_MS;
  return reservations.some(
    (r) => r.tableId === tableId && r.status === 'booked' && new Date(r.startsAt).getTime() <= limit,
  );
}

/** The device's local day as an ISO window `[from, to)` for `reservation.list`. */
export function dayRange(now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** `YYYY-MM-DDTHH:mm` local, the value format of `<input type="datetime-local">`. */
export function nextFullHourLocal(now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/api-contract && node --test src/floor.test.ts`
Expected: 11 passing.

- [ ] **Step 5: Export and register the test**

Append to `packages/api-contract/src/index.ts`:

```ts
export {
  FLOOR,
  RESERVED_LEAD_MS,
  clampPosition,
  dayRange,
  groupsOf,
  isReserved,
  nextFullHourLocal,
  scaleFor,
  seatsOf,
  type FloorReservation,
  type FloorTable,
} from './floor';
```

In `packages/api-contract/package.json` change the test script to:

```json
"test": "node --test src/refresh.test.ts src/refresh-link.test.ts src/floor.test.ts"
```

Run: `pnpm --filter @repo/api-contract test && pnpm --filter @repo/api-contract check-types && pnpm --filter @repo/api-contract lint`
Expected: all pass, exit 0.

---

### Task 7: Desktop floor plan — canvas, drag, table form

**Files:**
- Create: `apps/desktop/src/renderer/src/components/floor-plan.tsx`
- Create: `apps/desktop/src/renderer/src/components/table-form.tsx`
- Modify: `apps/desktop/src/renderer/src/app.tsx`

**Interfaces:**
- Consumes: `table.*` procedures (Task 4); `clampPosition`, `groupsOf`, `scaleFor`, `seatsOf` (Task 6); `useTRPC` from `../trpc`; `me.data.permissions` (existing).
- Produces: `export type FloorTable = RouterOutputs['table']['list'][number]`; `export const groupColor(headId: string | null): string`; `<FloorPlan permissions={string[]} />`; `<TableForm table={FloorTable | null} canDelete={boolean} onClose={() => void} />`.
- No unit tests: the renderer has none today. Verification is manual (Step 5).

- [ ] **Step 1: Write the table form**

Create `apps/desktop/src/renderer/src/components/table-form.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

// Mirrors the API's zod bounds; duplicated because the renderer cannot import from apps/api.
const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(20, 'At most 20 characters.'),
  seats: z.number({ error: 'Whole number.' }).int().min(1).max(50),
  shape: z.enum(['rect', 'round']),
  w: z.number({ error: 'Whole number.' }).int().min(40).max(500),
  h: z.number({ error: 'Whole number.' }).int().min(40).max(500),
});

type FormValues = z.infer<typeof schema>;

/** Create (table null) or edit + delete. A new table lands at 50,50; the manager drags it from there. */
export function TableForm({
  table,
  canDelete,
  onClose,
}: {
  table: FloorTable | null;
  canDelete: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.table.list.queryKey() });
    onClose();
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: table
      ? { name: table.name, seats: table.seats, shape: table.shape, w: table.w, h: table.h }
      : { name: '', seats: 4, shape: 'rect', w: 100, h: 100 },
  });

  const create = useMutation(trpc.table.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.table.update.mutationOptions());
  const updateLayout = useMutation(trpc.table.updateLayout.mutationOptions());
  const remove = useMutation(trpc.table.delete.mutationOptions({ onSuccess: done }));

  const error = create.error ?? update.error ?? updateLayout.error ?? remove.error;
  const pending = create.isPending || update.isPending || updateLayout.isPending || remove.isPending;

  const submit = async ({ name, seats, shape, w, h }: FormValues) => {
    if (!table) {
      await create.mutateAsync({ name, seats, shape, w, h, x: 50, y: 50 }).catch(() => undefined);
      return;
    }
    try {
      await update.mutateAsync({ id: table.id, name, seats, shape });
      if (w !== table.w || h !== table.h)
        await updateLayout.mutateAsync({ items: [{ id: table.id, x: table.x, y: table.y, w, h }] });
      done();
    } catch {
      // Shown through `error` below; the form stays open.
    }
  };

  return (
    <dialog open>
      <form onSubmit={handleSubmit(submit)}>
        <h3>{table ? `Edit ${table.name}` : 'New table'}</h3>

        <label htmlFor="table-name">Name</label>
        <input id="table-name" type="text" {...register('name')} />
        {errors.name && <p role="alert">{errors.name.message}</p>}

        <label htmlFor="table-seats">Seats</label>
        <input id="table-seats" type="number" min={1} max={50} {...register('seats', { valueAsNumber: true })} />
        {errors.seats && <p role="alert">{errors.seats.message}</p>}

        <label htmlFor="table-shape">Shape</label>
        <select id="table-shape" {...register('shape')}>
          <option value="rect">Rectangle</option>
          <option value="round">Round</option>
        </select>

        <label htmlFor="table-w">Width</label>
        <input id="table-w" type="number" min={40} max={500} {...register('w', { valueAsNumber: true })} />
        {errors.w && <p role="alert">{errors.w.message}</p>}

        <label htmlFor="table-h">Height</label>
        <input id="table-h" type="number" min={40} max={500} {...register('h', { valueAsNumber: true })} />
        {errors.h && <p role="alert">{errors.h.message}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {table && canDelete && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete ${table.name}?`)) remove.mutate({ id: table.id });
              }}
            >
              Delete
            </button>
          )}
        </div>
        {error && <p role="alert">{error.message}</p>}
      </form>
    </dialog>
  );
}
```

- [ ] **Step 2: Write the floor plan**

Create `apps/desktop/src/renderer/src/components/floor-plan.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { clampPosition, groupsOf, scaleFor, seatsOf, type RouterOutputs } from '@repo/api-contract';
import { useTRPC } from '../trpc';
import { TableForm } from './table-form';

export type FloorTable = RouterOutputs['table']['list'][number];
type Position = { x: number; y: number };

/** Group outline colour keyed by the head id, so a group keeps its colour across refetches. */
export const groupColor = (headId: string | null) =>
  headId ? `hsl(${parseInt(headId.slice(0, 6), 16) % 360}, 70%, 45%)` : '#999';

function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function FloorPlan({ permissions }: { permissions: string[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({ ...trpc.table.list.queryOptions(), refetchInterval: 30_000 });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FloorTable | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables being dragged or awaiting the server's answer. Kept outside the query
  // cache so a 30 s refetch landing mid-drag cannot yank a table back under the pointer.
  const [override, setOverride] = useState<Record<string, Position>>({});
  const dragRef = useRef<{ id: string; offset: Position; moved: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(containerRef);
  const scale = scaleFor(width, height);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: listKey });
  const release = (id: string) =>
    setOverride((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });

  const updateLayout = useMutation(
    trpc.table.updateLayout.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, (old) => old?.map((t) => rows.find((r) => r.id === t.id) ?? t));
        rows.forEach((r) => release(r.id));
      },
      onError: (error, input) => {
        setMessage(error.message);
        input.items.forEach((item) => release(item.id));
        invalidate();
      },
    }),
  );

  const positionOf = (t: FloorTable): Position => override[t.id] ?? { x: t.x, y: t.y };

  const onTap = (t: FloorTable) => {
    if (editing) setForm(t);
  };

  const onPointerDown = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = positionOf(t);
    dragRef.current = {
      id: t.id,
      offset: { x: event.clientX / scale - pos.x, y: event.clientY / scale - pos.y },
      moved: false,
    };
  };

  const onPointerMove = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.id !== t.id) return;
    drag.moved = true;
    const next = clampPosition(t, event.clientX / scale - drag.offset.x, event.clientY / scale - drag.offset.y);
    setOverride((current) => ({ ...current, [t.id]: next }));
  };

  const onPointerUp = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.id !== t.id) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      onTap(t);
      return;
    }
    const { x, y } = positionOf(t);
    updateLayout.mutate({ items: [{ id: t.id, x, y, w: t.w, h: t.h }] });
  };

  const onPointerCancel = (t: FloorTable) => () => {
    if (dragRef.current?.id !== t.id) return;
    dragRef.current = null;
    release(t.id);
  };

  return (
    <section>
      <h2>Floor</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {can('table.layout_manage') && (
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Done' : 'Edit layout'}
          </button>
        )}
        {editing && can('table.create') && (
          <button type="button" onClick={() => setForm('new')}>
            Add table
          </button>
        )}
      </div>
      {message && (
        <p role="alert" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}
      {list.error && <p role="alert">{list.error.message}</p>}

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          aspectRatio: '1 / 1',
          background: '#fafafa',
          border: '1px solid #ddd',
          overflow: 'hidden',
        }}
      >
        {tables.map((t) => {
          const pos = positionOf(t);
          const headId = t.mergedIntoId ?? (groups.has(t.id) ? t.id : null);
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onPointerDown={onPointerDown(t)}
              onPointerMove={onPointerMove(t)}
              onPointerUp={onPointerUp(t)}
              onPointerCancel={onPointerCancel(t)}
              style={{
                position: 'absolute',
                left: pos.x * scale,
                top: pos.y * scale,
                width: t.w * scale,
                height: t.h * scale,
                borderRadius: t.shape === 'round' ? '50%' : 8,
                border: `2px solid ${groupColor(headId)}`,
                background: '#eee',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
                userSelect: 'none',
                cursor: editing ? 'grab' : 'pointer',
              }}
            >
              <strong>{t.name}</strong>
              <small>{seatsOf(t.id, tables)} seats</small>
            </div>
          );
        })}
      </div>

      {form && (
        <TableForm
          table={form === 'new' ? null : form}
          canDelete={can('table.delete')}
          onClose={() => setForm(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Mount it on Home**

In `apps/desktop/src/renderer/src/app.tsx` add the import:

```tsx
import { FloorPlan } from './components/floor-plan';
```

and inside `Home`, after the `IdleTimeoutSetting` line:

```tsx
      {me.data?.permissions.includes('table.view') && <FloorPlan permissions={me.data.permissions} />}
```

- [ ] **Step 4: Type-check and lint**

Run: `pnpm --filter @repo/desktop check-types && pnpm --filter @repo/desktop lint`
Expected: exit 0. (`pnpm trpc:generate` must have run after Task 5 so `trpc.table` exists in the contract.)

- [ ] **Step 5: Manual check**

Run `pnpm --filter @repo/api dev` and `pnpm --filter @repo/desktop dev`, sign in as `owner / owner123`.

1. Floor section shows T1 and T2 from the curl smoke test at their positions.
2. "Edit layout" → "Add table" → name `T3`, seats 6, round → Save. T3 appears at top-left.
3. Drag T3 to the middle; release. Reload the app (Ctrl/Cmd+R): T3 is still in the middle.
4. Drag a table past the right edge: it stops at the edge.
5. In edit mode click T3 → change name to `T1` → Save → message `Table name already in use.`, form stays open. Cancel.
6. Click T3 → Delete → confirm → T3 disappears.
7. "Done" → clicking a table does nothing yet (Task 8 adds actions).

---

### Task 8: Desktop merge, reservations, reserved badge

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/floor-plan.tsx` (replace whole file)
- Create: `apps/desktop/src/renderer/src/components/reservation-form.tsx`
- Create: `apps/desktop/src/renderer/src/components/reservation-list.tsx`

**Interfaces:**
- Consumes: `table.merge`, `table.unmerge`, `reservation.*` (Tasks 4–5); `dayRange`, `isReserved`, `nextFullHourLocal` (Task 6); `TableForm`, `FloorTable`, `groupColor` (Task 7).
- Produces: `export type FloorReservationRow = RouterOutputs['reservation']['list'][number]`; `<ReservationForm table={FloorTable} onClose={() => void} />`; `<ReservationList reservations={FloorReservationRow[]} tables={FloorTable[]} canUpdate={boolean} />`.

- [ ] **Step 1: Reservation form**

Create `apps/desktop/src/renderer/src/components/reservation-form.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { nextFullHourLocal } from '@repo/api-contract';
import { z } from 'zod';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

const schema = z.object({
  customerName: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
  phone: z.string().trim().max(32, 'At most 32 characters.'),
  partySize: z.number({ error: 'Whole number.' }).int().min(1).max(100),
  // Value of <input type="datetime-local">: local wall-clock time, no offset.
  startsAt: z.string().min(1, 'Required.'),
  note: z.string().trim().max(500, 'At most 500 characters.'),
});

type FormValues = z.infer<typeof schema>;

export function ReservationForm({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customerName: '', phone: '', partySize: 2, startsAt: nextFullHourLocal(), note: '' },
  });

  const create = useMutation(
    trpc.reservation.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
        onClose();
      },
    }),
  );

  const submit = ({ customerName, phone, partySize, startsAt, note }: FormValues) =>
    create
      .mutateAsync({
        tableId: table.id,
        customerName,
        phone: phone || undefined,
        partySize,
        startsAt: new Date(startsAt).toISOString(),
        note: note || undefined,
      })
      .catch(() => undefined);

  return (
    <dialog open>
      <form onSubmit={handleSubmit(submit)}>
        <h3>Reserve {table.name}</h3>

        <label htmlFor="res-name">Customer</label>
        <input id="res-name" type="text" {...register('customerName')} />
        {errors.customerName && <p role="alert">{errors.customerName.message}</p>}

        <label htmlFor="res-phone">Phone</label>
        <input id="res-phone" type="tel" {...register('phone')} />
        {errors.phone && <p role="alert">{errors.phone.message}</p>}

        <label htmlFor="res-party">Party size</label>
        <input id="res-party" type="number" min={1} max={100} {...register('partySize', { valueAsNumber: true })} />
        {errors.partySize && <p role="alert">{errors.partySize.message}</p>}

        <label htmlFor="res-time">Time</label>
        <input id="res-time" type="datetime-local" {...register('startsAt')} />
        {errors.startsAt && <p role="alert">{errors.startsAt.message}</p>}

        <label htmlFor="res-note">Note</label>
        <input id="res-note" type="text" {...register('note')} />
        {errors.note && <p role="alert">{errors.note.message}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Reserve'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
    </dialog>
  );
}
```

- [ ] **Step 2: Reservation list**

Create `apps/desktop/src/renderer/src/components/reservation-list.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RouterOutputs } from '@repo/api-contract';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

export type FloorReservationRow = RouterOutputs['reservation']['list'][number];

const ACTIONS = [
  ['seated', 'Seat'],
  ['no_show', 'No-show'],
  ['cancelled', 'Cancel'],
] as const;

export function ReservationList({
  reservations,
  tables,
  canUpdate,
}: {
  reservations: FloorReservationRow[];
  tables: FloorTable[];
  canUpdate: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const update = useMutation(
    trpc.reservation.update.mutationOptions({
      // Settled, not success: a PRECONDITION_FAILED means someone else already resolved it.
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() }),
    }),
  );

  const nameOf = (tableId: string) => tables.find((t) => t.id === tableId)?.name ?? '?';
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section>
      <h3>Today&apos;s reservations</h3>
      {reservations.length === 0 && <p>None.</p>}
      <ul>
        {reservations.map((r) => (
          <li key={r.id}>
            {timeOf(r.startsAt)} · {nameOf(r.tableId)} · {r.customerName} × {r.partySize} · {r.status}
            {r.status === 'booked' &&
              canUpdate &&
              ACTIONS.map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  disabled={update.isPending}
                  style={{ marginLeft: 6 }}
                  onClick={() => update.mutate({ id: r.id, status })}
                >
                  {label}
                </button>
              ))}
          </li>
        ))}
      </ul>
      {update.error && <p role="alert">{update.error.message}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Replace `floor-plan.tsx` with the full version**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  clampPosition,
  dayRange,
  groupsOf,
  isReserved,
  scaleFor,
  seatsOf,
  type RouterOutputs,
} from '@repo/api-contract';
import { useTRPC } from '../trpc';
import { ReservationForm } from './reservation-form';
import { ReservationList } from './reservation-list';
import { TableForm } from './table-form';

export type FloorTable = RouterOutputs['table']['list'][number];
type Position = { x: number; y: number };

/** Group outline colour keyed by the head id, so a group keeps its colour across refetches. */
export const groupColor = (headId: string | null) =>
  headId ? `hsl(${parseInt(headId.slice(0, 6), 16) % 360}, 70%, 45%)` : '#999';

function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Re-renders once a minute so the "Reserved" badge appears on time without a refetch. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

export function FloorPlan({ permissions }: { permissions: string[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({ ...trpc.table.list.queryOptions(), refetchInterval: 30_000 });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const now = useNow();
  const reservationsQuery = useQuery({
    ...trpc.reservation.list.queryOptions(dayRange(now)),
    enabled: can('reservation.view'),
    refetchInterval: 30_000,
  });
  const reservations = reservationsQuery.data ?? [];

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FloorTable | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ headId: string; memberIds: string[] } | null>(null);
  const [reserving, setReserving] = useState<FloorTable | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables being dragged or awaiting the server's answer. Kept outside the query
  // cache so a 30 s refetch landing mid-drag cannot yank a table back under the pointer.
  const [override, setOverride] = useState<Record<string, Position>>({});
  const dragRef = useRef<{ id: string; offset: Position; moved: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(containerRef);
  const scale = scaleFor(width, height);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
  };
  const fail = (error: { message: string }) => {
    setMessage(error.message);
    invalidate();
  };
  const release = (id: string) =>
    setOverride((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });

  const updateLayout = useMutation(
    trpc.table.updateLayout.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, (old) => old?.map((t) => rows.find((r) => r.id === t.id) ?? t));
        rows.forEach((r) => release(r.id));
      },
      onError: (error, input) => {
        input.items.forEach((item) => release(item.id));
        fail(error);
      },
    }),
  );
  const merge = useMutation(
    trpc.table.merge.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, rows);
        setPicking(null);
      },
      onError: fail,
    }),
  );
  const unmerge = useMutation(
    trpc.table.unmerge.mutationOptions({
      onSuccess: (rows) => queryClient.setQueryData(listKey, rows),
      onError: fail,
    }),
  );

  const positionOf = (t: FloorTable): Position => override[t.id] ?? { x: t.x, y: t.y };
  const isStandalone = (t: FloorTable) => !t.mergedIntoId && !groups.has(t.id);
  const nameOf = (id: string) => tables.find((t) => t.id === id)?.name ?? '?';
  const current = selected ? tables.find((t) => t.id === selected) : undefined;

  const onTap = (t: FloorTable) => {
    if (editing) {
      setForm(t);
      return;
    }
    if (picking) {
      if (t.id === picking.headId) return;
      if (!isStandalone(t)) {
        setMessage('Unmerge first.');
        return;
      }
      setPicking({ ...picking, memberIds: toggle(picking.memberIds, t.id) });
      return;
    }
    setSelected((id) => (id === t.id ? null : t.id));
  };

  const onPointerDown = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = positionOf(t);
    dragRef.current = {
      id: t.id,
      offset: { x: event.clientX / scale - pos.x, y: event.clientY / scale - pos.y },
      moved: false,
    };
  };

  const onPointerMove = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.id !== t.id) return;
    drag.moved = true;
    const next = clampPosition(t, event.clientX / scale - drag.offset.x, event.clientY / scale - drag.offset.y);
    setOverride((current) => ({ ...current, [t.id]: next }));
  };

  const onPointerUp = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.id !== t.id) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (drag.moved) {
        const { x, y } = positionOf(t);
        updateLayout.mutate({ items: [{ id: t.id, x, y, w: t.w, h: t.h }] });
        return;
      }
    }
    onTap(t);
  };

  const onPointerCancel = (t: FloorTable) => () => {
    if (dragRef.current?.id !== t.id) return;
    dragRef.current = null;
    release(t.id);
  };

  return (
    <section>
      <h2>Floor</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {can('table.layout_manage') && (
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setSelected(null);
              setPicking(null);
            }}
          >
            {editing ? 'Done' : 'Edit layout'}
          </button>
        )}
        {editing && can('table.create') && (
          <button type="button" onClick={() => setForm('new')}>
            Add table
          </button>
        )}
      </div>
      {message && (
        <p role="alert" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}
      {list.error && <p role="alert">{list.error.message}</p>}
      {reservationsQuery.error && <p role="alert">{reservationsQuery.error.message}</p>}

      {picking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span>
            Merging into {nameOf(picking.headId)} — click tables to add ({picking.memberIds.length})
          </span>
          <button
            type="button"
            disabled={picking.memberIds.length === 0 || merge.isPending}
            onClick={() => merge.mutate(picking)}
          >
            Confirm
          </button>
          <button type="button" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}

      {current && !editing && !picking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <strong>{current.name}</strong>
          {can('table.merge') && !current.mergedIntoId && (
            <button type="button" onClick={() => setPicking({ headId: current.id, memberIds: [] })}>
              Merge
            </button>
          )}
          {can('table.merge') && !isStandalone(current) && (
            <button type="button" disabled={unmerge.isPending} onClick={() => unmerge.mutate({ id: current.id })}>
              Unmerge
            </button>
          )}
          {can('reservation.create') && (
            <button type="button" onClick={() => setReserving(current)}>
              Reserve
            </button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          aspectRatio: '1 / 1',
          background: '#fafafa',
          border: '1px solid #ddd',
          overflow: 'hidden',
        }}
      >
        {tables.map((t) => {
          const pos = positionOf(t);
          const headId = t.mergedIntoId ?? (groups.has(t.id) ? t.id : null);
          const picked = picking?.memberIds.includes(t.id) || picking?.headId === t.id;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onPointerDown={onPointerDown(t)}
              onPointerMove={onPointerMove(t)}
              onPointerUp={onPointerUp(t)}
              onPointerCancel={onPointerCancel(t)}
              style={{
                position: 'absolute',
                left: pos.x * scale,
                top: pos.y * scale,
                width: t.w * scale,
                height: t.h * scale,
                borderRadius: t.shape === 'round' ? '50%' : 8,
                border: `2px ${picked ? 'dashed' : 'solid'} ${groupColor(headId)}`,
                boxShadow: selected === t.id ? '0 0 0 3px #3b82f6' : undefined,
                background: '#eee',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
                userSelect: 'none',
                cursor: editing ? 'grab' : 'pointer',
              }}
            >
              <strong>{t.name}</strong>
              <small>{seatsOf(t.id, tables)} seats</small>
              {isReserved(t.id, reservations, now) && <small style={{ color: '#b45309' }}>Reserved</small>}
            </div>
          );
        })}
      </div>

      {can('reservation.view') && (
        <ReservationList reservations={reservations} tables={tables} canUpdate={can('reservation.update')} />
      )}

      {form && (
        <TableForm
          table={form === 'new' ? null : form}
          canDelete={can('table.delete')}
          onClose={() => setForm(null)}
        />
      )}
      {reserving && <ReservationForm table={reserving} onClose={() => setReserving(null)} />}
    </section>
  );
}
```

- [ ] **Step 4: Type-check and lint**

Run: `pnpm --filter @repo/desktop check-types && pnpm --filter @repo/desktop lint`
Expected: exit 0.

- [ ] **Step 5: Manual check**

With API and desktop running, as owner, with at least three tables:

1. Click T1 → action row shows Merge / Reserve. Click Merge → click T2 (dashed) → Confirm. T1 and T2 share an outline colour; T1 shows the summed seats.
2. Click T2 → Unmerge → T2 standalone again. Click T1 (still head of nobody) → no Unmerge button.
3. Merge T1 + T2 again, click T1 → Unmerge → both standalone.
4. Click T1 → Reserve → customer `Tan`, party 4, time 10 minutes from now → Reserve. T1 shows "Reserved"; the list shows the row with Seat / No-show / Cancel.
5. Edit layout → click T1 → Delete → message `Has a booked reservation.`
6. Seat the reservation → badge disappears, buttons gone, status `seated`.
7. Reserve T1 for 2 hours from now → no badge (appears 30 min before).
8. Create a second desktop session (or tablet, after Task 10) and drag a table: the other one follows within 30 s.

---

### Task 9: Tablet floor screen — gestures, drag, table form

**Files:**
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/src/app/index.tsx`
- Create: `apps/mobile/src/components/floor-table.tsx`
- Create: `apps/mobile/src/components/table-form.tsx`
- Create: `apps/mobile/src/app/floor.tsx`

**Interfaces:**
- Consumes: `table.*` procedures (Task 4); `clampPosition`, `groupsOf`, `scaleFor`, `seatsOf` (Task 6); `useTRPC`, `useAuthStore` (existing).
- Produces: `export type TableRow = RouterOutputs['table']['list'][number]`; `export const groupColor(headId: string | null): string`; `<FloorTable table position scale editing seats color reserved selected picked onTap onDrop />`; `<TableForm table={TableRow | null} canDelete onClose />`; route `/floor`.
- No unit tests: mobile has none and no test script. Verification is manual (Step 7).

- [ ] **Step 1: Gesture root**

`apps/mobile/src/app/_layout.tsx`: react-native-gesture-handler needs its root view above every `GestureDetector`. It forwards `View` props, so the capture responder that feeds the idle timer stays where it is. Replace the imports and `Shell`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useIdleTimer } from '@/hooks/use-idle-timer';
import { TRPCProvider, queryClient, trpcClient } from '@/lib/trpc';

/** Inside the providers so the idle hook can query settings. */
function Shell() {
  const bump = useIdleTimer();
  return (
    // Capture-phase responder sees every touch on every screen without stealing any of them —
    // including touches gesture-handler goes on to claim for a drag.
    <GestureHandlerRootView
      style={styles.root}
      onStartShouldSetResponderCapture={() => {
        bump();
        return false;
      }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
```

`RootLayout` and `styles` are unchanged.

- [ ] **Step 2: Floor button on Home**

`apps/mobile/src/app/index.tsx`: change the expo-router import to `import { Redirect, useRouter } from 'expo-router';`, add `const router = useRouter();` under `const trpc = useTRPC();`, and add this line directly above the `<View style={styles.spacer} />`:

```tsx
      {me.data?.permissions.includes('table.view') && <Button title="Floor" onPress={() => router.push('/floor')} />}
```

- [ ] **Step 3: One draggable table**

Create `apps/mobile/src/components/floor-table.tsx`:

```tsx
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { RouterOutputs } from '@repo/api-contract';

export type TableRow = RouterOutputs['table']['list'][number];

/** Group outline colour keyed by the head id, so a group keeps its colour across refetches. */
export const groupColor = (headId: string | null) =>
  headId ? `hsl(${parseInt(headId.slice(0, 6), 16) % 360}, 70%, 45%)` : '#999';

interface Props {
  table: TableRow;
  /** Canvas units; the parent applies its drag override before passing this. */
  position: { x: number; y: number };
  scale: number;
  editing: boolean;
  seats: number;
  color: string;
  reserved: boolean;
  selected: boolean;
  picked: boolean;
  onTap: (table: TableRow) => void;
  /** Called on the JS thread with the dropped position in canvas units, not yet clamped. */
  onDrop: (table: TableRow, x: number, y: number) => void;
}

export function FloorTable({
  table,
  position,
  scale,
  editing,
  seats,
  color,
  reserved,
  selected,
  picked,
  onTap,
  onDrop,
}: Props) {
  // Live drag offset in screen pixels, on the UI thread. Reset on drop; the parent's override then
  // moves `position` in the same frame so the table does not jump back.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(editing)
    .onUpdate((event) => {
      tx.value = event.translationX;
      ty.value = event.translationY;
    })
    .onEnd((event, success) => {
      tx.value = 0;
      ty.value = 0;
      // Not `success` = another gesture took over; the table snaps back and nothing is saved.
      if (!success) return;
      scheduleOnRN(
        onDrop,
        table,
        position.x + event.translationX / scale,
        position.y + event.translationY / scale,
      );
    });
  // `onStart` on a tap fires once it is recognised; `onEnd` would also fire for a failed tap.
  const tap = Gesture.Tap().onStart(() => scheduleOnRN(onTap, table));
  // Pan wins when the finger moves; a still finger falls through to tap. With editing off the pan
  // is disabled and every touch is a tap.
  const gesture = Gesture.Exclusive(pan, tap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.table,
          {
            left: position.x * scale,
            top: position.y * scale,
            width: table.w * scale,
            height: table.h * scale,
            borderRadius: table.shape === 'round' ? 999 : 8,
            borderColor: color,
            borderWidth: selected ? 4 : 2,
            borderStyle: picked ? 'dashed' : 'solid',
          },
          animated,
        ]}
      >
        <Text style={styles.name}>{table.name}</Text>
        <Text style={styles.small}>{seats} seats</Text>
        {reserved && <Text style={styles.badge}>Reserved</Text>}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  table: { position: 'absolute', backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  name: { fontWeight: '600' },
  small: { fontSize: 12, color: '#444' },
  badge: { fontSize: 12, color: '#b45309' },
});
```

- [ ] **Step 4: Table form modal**

Create `apps/mobile/src/components/table-form.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import type { TableRow } from '@/components/floor-table';
import { useTRPC } from '@/lib/trpc';

// TextInput yields strings; parse to numbers here. Bounds mirror the API's zod schema, duplicated
// because mobile cannot import from apps/api.
const whole = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Whole number.')
    .transform(Number)
    .pipe(z.number().min(min, `At least ${min}.`).max(max, `At most ${max}.`));

const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(20, 'At most 20 characters.'),
  seats: whole(1, 50),
  shape: z.enum(['rect', 'round']),
  w: whole(40, 500),
  h: whole(40, 500),
});

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

const FIELDS = [
  ['name', 'Name', 'default'],
  ['seats', 'Seats', 'number-pad'],
  ['w', 'Width', 'number-pad'],
  ['h', 'Height', 'number-pad'],
] as const;

/** Create (table null) or edit + delete. A new table lands at 50,50; the manager drags it from there. */
export function TableForm({
  table,
  canDelete,
  onClose,
}: {
  table: TableRow | null;
  canDelete: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.table.list.queryKey() });
    onClose();
  };

  const { control, handleSubmit, formState } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: table
      ? { name: table.name, seats: String(table.seats), shape: table.shape, w: String(table.w), h: String(table.h) }
      : { name: '', seats: '4', shape: 'rect', w: '100', h: '100' },
  });

  const create = useMutation(trpc.table.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.table.update.mutationOptions());
  const updateLayout = useMutation(trpc.table.updateLayout.mutationOptions());
  const remove = useMutation(trpc.table.delete.mutationOptions({ onSuccess: done }));

  const error = create.error ?? update.error ?? updateLayout.error ?? remove.error;
  const pending = create.isPending || update.isPending || updateLayout.isPending || remove.isPending;

  const submit = async ({ name, seats, shape, w, h }: FormOutput) => {
    if (!table) {
      await create.mutateAsync({ name, seats, shape, w, h, x: 50, y: 50 }).catch(() => undefined);
      return;
    }
    try {
      await update.mutateAsync({ id: table.id, name, seats, shape });
      if (w !== table.w || h !== table.h)
        await updateLayout.mutateAsync({ items: [{ id: table.id, x: table.x, y: table.y, w, h }] });
      done();
    } catch {
      // Shown through `error` below; the form stays open.
    }
  };

  const confirmDelete = () =>
    table &&
    Alert.alert(`Delete ${table.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate({ id: table.id }) },
    ]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>{table ? `Edit ${table.name}` : 'New table'}</Text>

        {FIELDS.map(([name, label, keyboardType]) => (
          <View key={name}>
            <Text style={styles.label}>{label}</Text>
            <Controller
              control={control}
              name={name}
              render={({ field }) => (
                <TextInput
                  style={styles.input}
                  keyboardType={keyboardType}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {formState.errors[name] && <Text style={styles.error}>{formState.errors[name]?.message}</Text>}
          </View>
        ))}

        <Text style={styles.label}>Shape</Text>
        <Controller
          control={control}
          name="shape"
          render={({ field }) => (
            <View style={styles.row}>
              {(['rect', 'round'] as const).map((shape) => (
                <Pressable
                  key={shape}
                  onPress={() => field.onChange(shape)}
                  style={[styles.chip, field.value === shape && styles.chipOn]}
                >
                  <Text>{shape === 'rect' ? 'Rectangle' : 'Round'}</Text>
                </Pressable>
              ))}
            </View>
          )}
        />

        <View style={styles.spacer} />
        <Button title={pending ? 'Saving…' : 'Save'} disabled={pending} onPress={handleSubmit(submit)} />
        <Button title="Cancel" onPress={onClose} />
        {table && canDelete && <Button title="Delete" color="#c00" disabled={pending} onPress={confirmDelete} />}
        {error && <Text style={styles.error}>{error.message}</Text>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  label: { color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
  chipOn: { backgroundColor: '#ddd', borderColor: '#888' },
  error: { color: '#c00' },
  spacer: { height: 8 },
});
```

- [ ] **Step 5: Floor screen (layout editing only; merge and reservations arrive in Task 10)**

Create `apps/mobile/src/app/floor.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clampPosition, groupsOf, scaleFor, seatsOf } from '@repo/api-contract';
import { FloorTable, groupColor, type TableRow } from '@/components/floor-table';
import { TableForm } from '@/components/table-form';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

type Position = { x: number; y: number };

export default function FloorScreen() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { accessToken, hydrated } = useAuthStore();
  const signedIn = Boolean(accessToken);

  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: signedIn });
  const permissions = me.data?.permissions ?? [];
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({
    ...trpc.table.list.queryOptions(),
    enabled: signedIn && can('table.view'),
    refetchInterval: 30_000,
  });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = scaleFor(size.width, size.height);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TableRow | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables just dropped and awaiting the server's answer, so a 30 s refetch landing
  // in between cannot snap a table back.
  const [override, setOverride] = useState<Record<string, Position>>({});

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: listKey });
  const release = (id: string) =>
    setOverride((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });

  const updateLayout = useMutation(
    trpc.table.updateLayout.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, (old) => old?.map((t) => rows.find((r) => r.id === t.id) ?? t));
        rows.forEach((r) => release(r.id));
      },
      onError: (error, input) => {
        input.items.forEach((item) => release(item.id));
        setMessage(error.message);
        invalidate();
      },
    }),
  );

  const positionOf = (t: TableRow): Position => override[t.id] ?? { x: t.x, y: t.y };

  const onTap = (t: TableRow) => {
    if (editing) setForm(t);
  };

  const onDrop = (t: TableRow, x: number, y: number) => {
    const next = clampPosition(t, x, y);
    setOverride((current) => ({ ...current, [t.id]: next }));
    updateLayout.mutate({ items: [{ id: t.id, ...next, w: t.w, h: t.h }] });
  };

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.bar}>
        <Button title="Back" onPress={() => router.back()} />
        <Text style={styles.title}>Floor</Text>
        {can('table.layout_manage') && (
          <Button title={editing ? 'Done' : 'Edit layout'} onPress={() => setEditing((value) => !value)} />
        )}
        {editing && can('table.create') && <Button title="Add table" onPress={() => setForm('new')} />}
      </View>
      {message && (
        <Pressable onPress={() => setMessage(null)}>
          <Text style={styles.error}>{message}</Text>
        </Pressable>
      )}
      {list.error && <Text style={styles.error}>{list.error.message}</Text>}

      <View
        style={styles.canvas}
        onLayout={(event) =>
          setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
        }
      >
        {scale > 0 &&
          tables.map((t) => (
            <FloorTable
              key={t.id}
              table={t}
              position={positionOf(t)}
              scale={scale}
              editing={editing}
              seats={seatsOf(t.id, tables)}
              color={groupColor(t.mergedIntoId ?? (groups.has(t.id) ? t.id : null))}
              reserved={false}
              selected={false}
              picked={false}
              onTap={onTap}
              onDrop={onDrop}
            />
          ))}
      </View>

      {form && (
        <TableForm table={form === 'new' ? null : form} canDelete={can('table.delete')} onClose={() => setForm(null)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: '600', flex: 1 },
  // Square canvas that fits the shorter side of the screen.
  canvas: {
    flex: 1,
    aspectRatio: 1,
    alignSelf: 'center',
    maxWidth: '100%',
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  error: { color: '#c00' },
});
```

- [ ] **Step 6: Type-check and lint**

Run: `pnpm --filter @repo/mobile check-types && pnpm --filter @repo/mobile lint`
Expected: exit 0.

- [ ] **Step 7: Manual check**

Run `pnpm --filter @repo/api dev` and `pnpm --filter @repo/mobile dev`, open on a tablet or simulator, sign in as owner (password, then set a PIN).

1. Home shows "Floor". Tap → the tables from earlier tasks appear at the same relative positions as on desktop.
2. With "Edit layout" off, dragging does nothing; tapping does nothing.
3. "Edit layout" → drag T1 across the canvas; it follows the finger and stays where dropped. Desktop shows the new position within 30 s.
4. Drag off the edge → clamps at the edge.
5. "Add table" → `T4`, seats `8`, round → Save → appears top-left. Tap it → change name → Save. Delete → confirm → gone.
6. Enter a non-number in Seats → `Whole number.` error, no request.
7. After a drag, wait past `settings.idleTimeoutSeconds` without touching: the tablet still parks (the capture responder saw the drag).

---

### Task 10: Tablet merge, reservations, reserved badge

**Files:**
- Create: `apps/mobile/src/components/reservation-form.tsx`
- Modify: `apps/mobile/src/app/floor.tsx` (replace whole file)

**Interfaces:**
- Consumes: `table.merge`, `table.unmerge`, `reservation.*` (Tasks 4–5); `dayRange`, `isReserved`, `nextFullHourLocal` (Task 6); `FloorTable`, `TableRow`, `groupColor`, `TableForm` (Task 9).
- Produces: `<ReservationForm table={TableRow} onClose />`.

- [ ] **Step 1: Reservation form modal**

Create `apps/mobile/src/components/reservation-form.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Button, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nextFullHourLocal } from '@repo/api-contract';
import { z } from 'zod';
import type { TableRow } from '@/components/floor-table';
import { useTRPC } from '@/lib/trpc';

// ponytail: date and time are text fields (YYYY-MM-DD, HH:mm). No native picker is installed;
// swap for @expo/ui DateTimePicker once the dev build is in place.
const schema = z
  .object({
    customerName: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
    phone: z.string().trim().max(32, 'At most 32 characters.'),
    partySize: z
      .string()
      .regex(/^\d+$/, 'Whole number.')
      .transform(Number)
      .pipe(z.number().min(1, 'At least 1.').max(100, 'At most 100.')),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm'),
    note: z.string().trim().max(500, 'At most 500 characters.'),
  })
  // No offset in the string, so JS parses it as device-local time — what the waiter means.
  .refine((values) => !Number.isNaN(new Date(`${values.date}T${values.time}`).getTime()), {
    message: 'Not a valid date and time.',
    path: ['time'],
  });

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

const FIELDS = [
  ['customerName', 'Customer', 'default'],
  ['phone', 'Phone', 'phone-pad'],
  ['partySize', 'Party size', 'number-pad'],
  ['date', 'Date (YYYY-MM-DD)', 'numbers-and-punctuation'],
  ['time', 'Time (HH:mm)', 'numbers-and-punctuation'],
  ['note', 'Note', 'default'],
] as const;

export function ReservationForm({ table, onClose }: { table: TableRow; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [date, time] = nextFullHourLocal().split('T') as [string, string];

  const { control, handleSubmit, formState } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { customerName: '', phone: '', partySize: '2', date, time, note: '' },
  });

  const create = useMutation(
    trpc.reservation.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
        onClose();
      },
    }),
  );

  const submit = (values: FormOutput) =>
    create
      .mutateAsync({
        tableId: table.id,
        customerName: values.customerName,
        phone: values.phone || undefined,
        partySize: values.partySize,
        startsAt: new Date(`${values.date}T${values.time}`).toISOString(),
        note: values.note || undefined,
      })
      .catch(() => undefined);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Reserve {table.name}</Text>

        {FIELDS.map(([name, label, keyboardType]) => (
          <View key={name}>
            <Text style={styles.label}>{label}</Text>
            <Controller
              control={control}
              name={name}
              render={({ field }) => (
                <TextInput
                  style={styles.input}
                  keyboardType={keyboardType}
                  autoCapitalize={name === 'customerName' ? 'words' : 'none'}
                  autoCorrect={false}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {formState.errors[name] && <Text style={styles.error}>{formState.errors[name]?.message}</Text>}
          </View>
        ))}

        <View style={styles.spacer} />
        <Button title={create.isPending ? 'Saving…' : 'Reserve'} disabled={create.isPending} onPress={handleSubmit(submit)} />
        <Button title="Cancel" onPress={onClose} />
        {create.error && <Text style={styles.error}>{create.error.message}</Text>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  label: { color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: '#c00' },
  spacer: { height: 8 },
});
```

- [ ] **Step 2: Replace `apps/mobile/src/app/floor.tsx` with the full version**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clampPosition, dayRange, groupsOf, isReserved, scaleFor, seatsOf } from '@repo/api-contract';
import { FloorTable, groupColor, type TableRow } from '@/components/floor-table';
import { ReservationForm } from '@/components/reservation-form';
import { TableForm } from '@/components/table-form';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

type Position = { x: number; y: number };

const ACTIONS = [
  ['seated', 'Seat'],
  ['no_show', 'No-show'],
  ['cancelled', 'Cancel'],
] as const;

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** Re-renders once a minute so the "Reserved" badge appears on time without a refetch. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function FloorScreen() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { accessToken, hydrated } = useAuthStore();
  const signedIn = Boolean(accessToken);

  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: signedIn });
  const permissions = me.data?.permissions ?? [];
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({
    ...trpc.table.list.queryOptions(),
    enabled: signedIn && can('table.view'),
    refetchInterval: 30_000,
  });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const now = useNow();
  const reservationsQuery = useQuery({
    ...trpc.reservation.list.queryOptions(dayRange(now)),
    enabled: signedIn && can('reservation.view'),
    refetchInterval: 30_000,
  });
  const reservations = reservationsQuery.data ?? [];

  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = scaleFor(size.width, size.height);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TableRow | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ headId: string; memberIds: string[] } | null>(null);
  const [reserving, setReserving] = useState<TableRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables just dropped and awaiting the server's answer, so a 30 s refetch landing
  // in between cannot snap a table back.
  const [override, setOverride] = useState<Record<string, Position>>({});

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
  };
  const fail = (error: { message: string }) => {
    setMessage(error.message);
    invalidate();
  };
  const release = (id: string) =>
    setOverride((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });

  const updateLayout = useMutation(
    trpc.table.updateLayout.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, (old) => old?.map((t) => rows.find((r) => r.id === t.id) ?? t));
        rows.forEach((r) => release(r.id));
      },
      onError: (error, input) => {
        input.items.forEach((item) => release(item.id));
        fail(error);
      },
    }),
  );
  const merge = useMutation(
    trpc.table.merge.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, rows);
        setPicking(null);
      },
      onError: fail,
    }),
  );
  const unmerge = useMutation(
    trpc.table.unmerge.mutationOptions({
      onSuccess: (rows) => queryClient.setQueryData(listKey, rows),
      onError: fail,
    }),
  );
  const updateReservation = useMutation(
    trpc.reservation.update.mutationOptions({
      // Settled, not success: a PRECONDITION_FAILED means someone else already resolved it.
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() }),
    }),
  );

  const positionOf = (t: TableRow): Position => override[t.id] ?? { x: t.x, y: t.y };
  const isStandalone = (t: TableRow) => !t.mergedIntoId && !groups.has(t.id);
  const nameOf = (id: string) => tables.find((t) => t.id === id)?.name ?? '?';
  const current = selected ? tables.find((t) => t.id === selected) : undefined;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const onTap = (t: TableRow) => {
    if (editing) {
      setForm(t);
      return;
    }
    if (picking) {
      if (t.id === picking.headId) return;
      if (!isStandalone(t)) {
        setMessage('Unmerge first.');
        return;
      }
      setPicking({ ...picking, memberIds: toggle(picking.memberIds, t.id) });
      return;
    }
    setSelected((id) => (id === t.id ? null : t.id));
  };

  const onDrop = (t: TableRow, x: number, y: number) => {
    const next = clampPosition(t, x, y);
    setOverride((current) => ({ ...current, [t.id]: next }));
    updateLayout.mutate({ items: [{ id: t.id, ...next, w: t.w, h: t.h }] });
  };

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.bar}>
        <Button title="Back" onPress={() => router.back()} />
        <Text style={styles.title}>Floor</Text>
        {can('table.layout_manage') && (
          <Button
            title={editing ? 'Done' : 'Edit layout'}
            onPress={() => {
              setEditing((value) => !value);
              setSelected(null);
              setPicking(null);
            }}
          />
        )}
        {editing && can('table.create') && <Button title="Add table" onPress={() => setForm('new')} />}
      </View>
      {message && (
        <Pressable onPress={() => setMessage(null)}>
          <Text style={styles.error}>{message}</Text>
        </Pressable>
      )}
      {list.error && <Text style={styles.error}>{list.error.message}</Text>}
      {reservationsQuery.error && <Text style={styles.error}>{reservationsQuery.error.message}</Text>}

      {picking && (
        <View style={styles.bar}>
          <Text style={styles.grow}>
            Merging into {nameOf(picking.headId)} — tap tables to add ({picking.memberIds.length})
          </Text>
          <Button
            title="Confirm"
            disabled={picking.memberIds.length === 0 || merge.isPending}
            onPress={() => merge.mutate(picking)}
          />
          <Button title="Cancel" onPress={() => setPicking(null)} />
        </View>
      )}

      {current && !editing && !picking && (
        <View style={styles.bar}>
          <Text style={styles.name}>{current.name}</Text>
          {can('table.merge') && !current.mergedIntoId && (
            <Button title="Merge" onPress={() => setPicking({ headId: current.id, memberIds: [] })} />
          )}
          {can('table.merge') && !isStandalone(current) && (
            <Button title="Unmerge" disabled={unmerge.isPending} onPress={() => unmerge.mutate({ id: current.id })} />
          )}
          {can('reservation.create') && <Button title="Reserve" onPress={() => setReserving(current)} />}
        </View>
      )}

      <View
        style={styles.canvas}
        onLayout={(event) =>
          setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
        }
      >
        {scale > 0 &&
          tables.map((t) => (
            <FloorTable
              key={t.id}
              table={t}
              position={positionOf(t)}
              scale={scale}
              editing={editing}
              seats={seatsOf(t.id, tables)}
              color={groupColor(t.mergedIntoId ?? (groups.has(t.id) ? t.id : null))}
              reserved={isReserved(t.id, reservations, now)}
              selected={selected === t.id}
              picked={Boolean(picking && (picking.headId === t.id || picking.memberIds.includes(t.id)))}
              onTap={onTap}
              onDrop={onDrop}
            />
          ))}
      </View>

      {can('reservation.view') && (
        <ScrollView style={styles.list}>
          <Text style={styles.name}>Today&apos;s reservations</Text>
          {reservations.length === 0 && <Text style={styles.hint}>None.</Text>}
          {reservations.map((r) => (
            <View key={r.id} style={styles.bar}>
              <Text style={styles.grow}>
                {timeOf(r.startsAt)} · {nameOf(r.tableId)} · {r.customerName} × {r.partySize} · {r.status}
              </Text>
              {r.status === 'booked' &&
                can('reservation.update') &&
                ACTIONS.map(([status, label]) => (
                  <Button
                    key={status}
                    title={label}
                    disabled={updateReservation.isPending}
                    onPress={() => updateReservation.mutate({ id: r.id, status })}
                  />
                ))}
            </View>
          ))}
          {updateReservation.error && <Text style={styles.error}>{updateReservation.error.message}</Text>}
        </ScrollView>
      )}

      {form && (
        <TableForm table={form === 'new' ? null : form} canDelete={can('table.delete')} onClose={() => setForm(null)} />
      )}
      {reserving && <ReservationForm table={reserving} onClose={() => setReserving(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: '600', flex: 1 },
  name: { fontWeight: '600' },
  grow: { flex: 1 },
  hint: { color: '#666' },
  // Square canvas that fits the shorter side of the screen.
  canvas: {
    flex: 1,
    aspectRatio: 1,
    alignSelf: 'center',
    maxWidth: '100%',
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  list: { maxHeight: 200 },
  error: { color: '#c00' },
});
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm --filter @repo/mobile check-types && pnpm --filter @repo/mobile lint`
Expected: exit 0.

- [ ] **Step 4: Manual check**

With API, desktop and mobile running, as owner:

1. Tablet: tap T1 → Merge → tap T2 (dashed) → Confirm. Group outline shared; T1 shows summed seats. Desktop shows the group within 30 s.
2. Tablet: tap T1 → Unmerge → both standalone.
3. Tablet: tap T1 → Reserve → customer `Lim`, party `3`, time 10 minutes from now → Reserve. "Reserved" badge on T1; row in the list.
4. Desktop: the same reservation appears within 30 s. Seat it there. Tablet: badge gone within 30 s.
5. Tablet: try to Cancel the seated reservation from a stale list (before the refetch) → message `Reservation is closed.`, list refreshes.
6. Sign in on the tablet as a waiter with no `table.layout_manage`: no "Edit layout" button; Merge and Reserve still there.

---

### Task 11: Repo-wide verification and manual checklist

**Files:** none new.

- [ ] **Step 1: Automated checks across the monorepo**

Run from the repo root:

```sh
pnpm lint && pnpm check-types && pnpm test
```

Expected: every package exits 0. Tests run in `@repo/api` (5 files) and `@repo/api-contract` (3 files).

- [ ] **Step 2: Contract is current**

Run: `pnpm trpc:generate && git status --short packages/api-contract/src/server.ts`
Expected: the file is listed as modified only if it was not regenerated after the last router change; running it again then shows no further change (`git diff --stat packages/api-contract/src/server.ts` stable across two runs).

- [ ] **Step 3: Full manual checklist (spec section 8)**

With API, desktop and tablet running:

- [ ] create a table (desktop and tablet)
- [ ] rename a table
- [ ] drag on desktop; drag on tablet
- [ ] position appears on the other client within 30 s
- [ ] merge; unmerge head (group dissolves); unmerge member (only it leaves)
- [ ] delete blocked when merged (`Unmerge first.`); delete blocked when booked (`Has a booked reservation.`)
- [ ] reservation create / seat / no-show / cancel
- [ ] badge appears 30 min before `startsAt`, stays while overdue, clears on seat
- [ ] idle timer still parks the tablet after a drag
- [ ] waiter gets `FORBIDDEN` on `table.create` (curl with a waiter token, or a waiter account created via `auth.register` + role set in `db:studio`)
- [ ] two managers drag the same table: last write wins, both converge within 30 s

- [ ] **Step 4: Leave the work uncommitted**

Do not commit or branch. `git status` should show the new and modified files from the file map; hand back to the user.
