# Outlets and Staff Binding — Design

**Date:** 2026-09-16
**Status:** approved in brainstorming, awaiting implementation plan

## Goal

An outlet is a physical location of the business — its own address, its own terminals, and later
its own menu and orders. This spec makes outlets real rows and binds staff to them: a user works at
zero, one, or many outlets, and an owner or manager edits that roster through the API.

## Non-goals

These are deliberate, and most belong to the follow-up spec named below.

- **Active outlet in a session.** Nothing in this spec tells the server which outlet a signed-in
  user is currently working in. Login, tokens and `auth.me` are untouched.
- **Mobile device registration.** Tablets will register to an outlet; no `terminals` table here.
- **Desktop outlet picker**, and any other UI. This spec is API and contract only.
- **Outlet-scoping of domain data.** `tables` and `reservations` stay global. No `outlet_id`
  anywhere but `outlet_staff`.
- **A `user.list` endpoint**, user CRUD, role assignment screens — the staff-admin subsystem.
- Timezone, tax rate, currency, opening hours, receipt header on the outlet row. No code reads
  them yet.

### The follow-up spec

*Active outlet and terminal binding* covers: desktop chooses an outlet after login from the ones the
user is bound to; mobile registers the device to an outlet and login at that device forces it;
the chosen outlet rides in the session; membership is enforced on outlet-scoped calls. It depends
on this spec and is not started until this one ships.

## Core idea

Two tables and one join, following patterns the repo already uses. `outlets` copies `tables`:
soft delete plus partial unique indexes, so a closed location keeps its history and its name can be
reused. `outlet_staff` copies `role_permissions`: a bare composite primary key with a reverse index,
no surrogate id, no timestamps. Membership is edited as a **set**, not as individual rows — one
`setStaff` mutation replaces an outlet's roster, which is idempotent and has no duplicate or
already-assigned error path to design.

## 1. Schema (`apps/api/src/db/schema.ts`)

```ts
export const outlets = pgTable(
  'outlets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Short human key shown on receipts and terminal setup, e.g. 'HQ', 'BR2'. Stored uppercase.
    code: text('code').notNull(),
    address: text('address'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Soft delete: a closed outlet still owns past sales and the staff rows that point at it.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // A closed 'Downtown' can be reopened under the same name; only live rows must be unique.
    uniqueIndex('outlets_name_active_idx').on(table.name).where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('outlets_code_active_idx').on(table.code).where(sql`${table.deletedAt} IS NULL`),
  ],
);

/** Which staff may work at an outlet. No row = not assigned; zero outlets is a valid state. */
export const outletStaff = pgTable(
  'outlet_staff',
  {
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.outletId, table.userId] }),
    // The PK covers outlet -> staff, which `outlet.staff` reads; this covers the reverse, which
    // login will read in the next spec to decide whether the user picks an outlet.
    index('outlet_staff_user_id_idx').on(table.userId),
  ],
);

export type Outlet = typeof outlets.$inferSelect;
export type OutletStaff = typeof outletStaff.$inferSelect;
```

Decisions worth keeping:

- **The column is `user_id`, not `staff_id`.** It is a foreign key to `users`; "staff" is the role
  word, `users` is the table. A `staff_id` pointing at `users.id` would read as a second table.
- **Zero outlets is legal.** A user created before any outlet exists, or an owner who works
  everywhere, holds no rows. What that means at login is the follow-up spec's problem.
- **Both cascades are unreachable today** — outlets and users are both soft-deleted. They are there
  so a genuine hard delete, in a test or a data fix, cannot strand rows.
- **Unassigning deletes the row.** No `unassigned_at`; staff-movement audit is not in scope.

Migration: `pnpm --filter @repo/api db:generate` (expected `drizzle/0003_*.sql`), then `db:migrate`.

## 2. Permissions (`apps/api/drizzle/seed/seed-rbac.ts`)

`PERMISSIONS` lists the roles that hold a permission *besides* owner and manager, who hold
everything except `OWNER_ONLY`.

```ts
'outlet.view': ['cashier', 'waiter', 'inventory_staff', 'auditor'],
'outlet.staff_assign': [],           // owner + manager
'outlet.manage': [],                 // also added to OWNER_ONLY -> owner alone
```

Opening or closing a location is an owner act; moving staff between locations is the manager's
day-to-day. `OWNER_ONLY` gains `'outlet.manage'` alongside `'settings.manage'`.

The seed is already idempotent: re-running `db:seed` inserts the three new permissions and their
role grants and prunes nothing else.

## 3. Module (`apps/api/src/outlet/`)

`outlet.module.ts`, `outlet.router.ts`, `outlet.service.ts`, `outlet-rules.ts` — the same shape as
`floor/`. The module imports `AuthModule` (for `RbacService` and `ProtectedMiddleware`) and is
registered in `app.module.ts` after `FloorModule`.

### Router (`@Router({ alias: 'outlet' })`)

Every procedure is behind `ProtectedMiddleware`, and `await this.rbac.require(ctx.user.id, …)` is
the first line of each, exactly as in `TableRouter`.

| procedure | input | output | permission |
|---|---|---|---|
| `list` | — | `outletOutput[]` | `outlet.view` |
| `create` | `{ name, code, address?, phone? }` | `outletOutput` | `outlet.manage` |
| `update` | `{ id, name, code, address?, phone? }` | `outletOutput` | `outlet.manage` |
| `remove` | `{ id }` | `{ success: boolean }` | `outlet.manage` |
| `staff` | `{ outletId }` | `staffOutput[]` | `outlet.staff_assign` |
| `setStaff` | `{ outletId, userIds }` | `staffOutput[]` | `outlet.staff_assign` |

```ts
const outletOutput = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
});

const staffOutput = z.object({ id: z.string(), name: z.string(), username: z.string() });
```

The roster sits behind `outlet.staff_assign`, not `outlet.view`: a cashier needs the outlet list to
name where they are, not the list of who else works there.

Input bounds, written as literals inline in the decorators because the contract generator cannot
hoist an identifier a schema references:

- `name`: `z.string().trim().min(1).max(60)`
- `code`: `z.string().trim().min(1).max(12).regex(/^[a-zA-Z0-9-]+$/)`
- `address`: `z.string().trim().max(200).optional()`
- `phone`: `z.string().trim().max(32).optional()`
- `id` / `outletId`: `z.uuid()`
- `userIds`: `z.array(z.uuid()).max(200)`

`update` takes the full field set, not a patch — it is a form save, and a partial update has no
caller. An omitted `address` or `phone` therefore **clears** the column to null rather than leaving
it as it was.

Ids are `z.uuid()`, not the plain `z.string()` the floor routers use for ids. A malformed id under
`z.string()` reaches Postgres and comes back as a `22P02` driver error — a 500 where the caller
should see a 400. The floor routers are not retrofitted here; that is their own change.

### Service

- `list()` — live rows ordered by `name`, mapped through an `outletOutput(row)` function that drops
  the timestamps and `deletedAt`, mirroring `tableOutput`.
- `create(input)` / `update(id, input)` — `normalizeCode` first, so `br2` and `BR2` collide as they
  should. `update` resolves the row through a private `find(id)` that throws `NOT_FOUND` on a
  missing or soft-deleted id. Both catch a unique violation and rethrow `CONFLICT` naming the field
  that collided.
- `remove(id)` — `find(id)`, then set `deletedAt`. No precondition check: nothing references outlets
  yet. The `outlet_staff` rows stay behind and `list` / `staff` never see them again, so reopening
  an outlet by clearing `deletedAt` in a data fix restores its roster intact.
- `staff(outletId)` — `find(outletId)`, then `outlet_staff` joined to `users` filtered to live
  users, ordered by name.
- `setStaff(outletId, userIds)` — one transaction:
  1. `find(outletId)`.
  2. Load the live users among the deduplicated `userIds`; if any id is missing, throw
     `BAD_REQUEST` naming the first one.
  3. `delete from outlet_staff where outlet_id = $1 and user_id not in (...)` — with an empty
     `userIds`, the whole roster goes.
  4. `insert ... onConflictDoNothing()` for the rest.
  5. Return the new roster, so the caller never has to re-read.

### Pure rules (`outlet-rules.ts`)

Extracted so the logic that can actually be wrong is testable without a database. Signatures below;
the bodies are the implementation plan's job:

```ts
/** Codes are compared case-insensitively by storing them one way. */
export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

/** What `setStaff` must write to turn `current` into `desired`. Duplicates in `desired` collapse. */
export const staffDiff = (
  current: string[],
  desired: string[],
): { add: string[]; remove: string[] } => { /* set difference both ways */ };

/** Which field a unique violation was about, from the constraint name. Null = not ours, rethrow. */
export const conflictField = (constraint: string): 'name' | 'code' | null => { /* … */ };
```

## 4. Shared helper move

`isUniqueViolation` lives inside `apps/api/src/floor/table.service.ts` today. It unwraps a quirk —
drizzle ≥ 0.44 wraps driver errors, so both `error.code` and `error.cause.code` have to be checked
for `23505`. Move it to `apps/api/src/db/errors.ts` and import it in both `table.service.ts` and
`outlet.service.ts`, rather than copying that quirk into a second file. No behaviour change.

## 5. Errors

Every one a `TRPCError`, rendered by the existing `errorFormatter`.

| case | code | message |
|---|---|---|
| duplicate live name | `CONFLICT` | `Outlet name already in use.` |
| duplicate live code | `CONFLICT` | `Outlet code already in use.` |
| id missing or soft-deleted | `NOT_FOUND` | `Outlet not found.` |
| `setStaff` id is not a live user | `BAD_REQUEST` | `Not a valid user: <id>.` |
| permission not held | `FORBIDDEN` | `Requires outlet.manage.` (from `rbac.require`) |

## 6. Contract

`packages/api-contract/src/server.ts` is generated, never hand-edited. After the router lands, run
`pnpm --filter @repo/api trpc:generate` (or rely on the `trpc watch` half of `pnpm dev`) and commit
the regenerated file.

## 7. Tests

The repo runs `node --test` over an explicit file list in `apps/api/package.json`, with no database
in the loop. New file `apps/api/src/outlet/outlet-rules.test.ts`, **added to that list** — it is
explicit, not a glob.

- `normalizeCode`: `' br2 '` → `'BR2'`; an already-uppercase code is returned unchanged.
- `staffDiff`: disjoint sets produce the full add and full remove; identical sets produce two empty
  arrays; `desired: []` removes everyone and adds nothing; a duplicate in `desired` is added once.
- `conflictField`: `'outlets_name_active_idx'` → `'name'`, `'outlets_code_active_idx'` → `'code'`,
  anything else → `null`.

Added to the existing `drizzle/seed/seed-rbac.test.ts`:

- `holdersOf('outlet.manage')` is `['owner']` — the second owner-only permission.
- `holdersOf('outlet.view')` includes cashier, waiter, inventory_staff and auditor.

`setStaff`'s transaction is not covered: this repo has no DB harness, and `staffDiff` carries the
part that could be wrong. Manual check after implementing — create two outlets, assign the seeded
owner to both, call `setStaff` with an empty array, confirm the roster empties and the outlet rows
survive.

## Success criteria

1. `db:migrate` and `db:seed` run clean on an existing database.
2. An owner can create, rename, and close an outlet; a manager gets `FORBIDDEN` on all three.
3. A manager can read and replace an outlet's roster; a cashier gets `FORBIDDEN` on both.
4. A cashier can `list` outlets.
5. Closing an outlet hides it from `list` and frees its name and code for reuse.
6. `setStaff` is idempotent — calling it twice with the same ids leaves the same rows.
7. `pnpm --filter @repo/api test`, `lint`, and `check-types` pass.
