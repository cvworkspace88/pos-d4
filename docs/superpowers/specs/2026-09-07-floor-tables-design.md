# Floor Tables, Merge, Reservations — Design

**Date:** 2026-09-07
**Status:** approved in brainstorming, awaiting implementation plan

## Goal

Tables become real rows. An owner or manager lays out the floor by dragging tables into position on
desktop or tablet, creates and deletes tables, and edits their name, seats, shape and size. Floor
staff see the same plan on both clients, join tables into a group for a large party and split them
again, and book reservations against a table. Every action has its own permission.

## Non-goals

- Orders, occupancy, table status (open / occupied / closed). Tables have no service state yet.
- Reservation time windows, overlap checks, waitlists, customer directory, reminders.
- Floor areas or multiple floors. One canvas.
- Resize handles, snap-to-grid, rotation, pinch-zoom, live push. Polling covers sync.
- Manager approval flows for merge. The old `table.merge_request` / `table.merge_approve` pair
  is replaced by one direct `table.merge`.

## Core idea: positions live on the table row, merge is a self-reference

A table row carries its own `x, y, w, h` in a virtual `1000 × 1000` canvas. Each client scales that
canvas uniformly to its viewport, so desktop and tablet draw every table in the same place. A merge
group is `merged_into_id` on the member rows pointing at the head row; the head carries no marker
and nothing else changes. Unmerge nulls the column. No group table, no layout blob.

## 1. Schema (`apps/api/src/db/schema.ts`)

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
    // Set on members of a merge group, pointing at the head. Null = standalone or head.
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

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict on delete: tables are soft-deleted, so the FK is never hit.
    tableId: uuid('table_id').notNull().references(() => tables.id),
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

export type Table = typeof tables.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
```

Migration: one new `drizzle/0001_*.sql` from `pnpm db:generate`, applied with `pnpm db:migrate`.
No squash.

## 2. Permissions (`apps/api/drizzle/seed/seed-rbac.ts`)

Owner and manager hold everything (except `OWNER_ONLY`, unchanged). Holders listed are the
additional roles.

| Change | Permission | Holders besides owner / manager |
| --- | --- | --- |
| keep | `table.view` | waiter, cashier |
| add | `table.create` | — |
| add | `table.delete` | — |
| keep | `table.layout_manage` — move, resize, rename, seats, shape | — |
| **replace** `table.merge_request` + `table.merge_approve` | `table.merge` — merge and unmerge | waiter, cashier |
| add | `reservation.view` | waiter, cashier |
| add | `reservation.create` | waiter, cashier |
| add | `reservation.update` — seat, no-show, cancel, edit | waiter, cashier |

Other `table.*` permissions (`assign`, `transfer_*`, `close`, `force_close_*`, `reopen_*`) stay as
seeded; they belong to future orders work.

`seedRbac` gains one step after inserting permissions: delete every `permissions` row whose `name`
is not a key of `PERMISSIONS`. The FK cascade clears `role_permissions`. The seed is now the source
of truth and the two replaced names leave the database on the next `pnpm db:seed`. Roles are not
pruned.

`seed-rbac.test.ts` gains: `holdersOf('table.merge')` is `['owner', 'manager', 'waiter', 'cashier']`
and `'table.merge_request' in PERMISSIONS` is `false`.

## 3. API (`apps/api/src/floor/`)

Files: `floor.module.ts`, `floor-rules.ts`, `table.router.ts`, `table.service.ts`,
`reservation.router.ts`, `reservation.service.ts`. `FloorModule` imports `AuthModule` for
`ProtectedMiddleware` and `RbacService`; `AppModule` registers it. Every procedure is behind
`ProtectedMiddleware` and calls `await this.rbac.require(ctx.user.id, '<permission>')` inline, the
`settings.update` pattern. `pnpm trpc:generate` regenerates the contract.

### `table` router (alias `table`)

| Procedure | Permission | Behaviour |
| --- | --- | --- |
| `list` | `table.view` | Live tables (`deleted_at IS NULL`): `{ id, name, seats, shape, x, y, w, h, mergedIntoId }[]`. Groups are derived on the client from `mergedIntoId`. |
| `create({ name, seats, shape, x, y, w, h })` | `table.create` | Insert. Duplicate live name → `CONFLICT` "Table name already in use." Returns the row. |
| `update({ id, name, seats, shape })` | `table.layout_manage` | Rename, seats, shape. All three required: the form always sends them, and an all-optional patch invites an empty UPDATE. Same name rule. |
| `updateLayout({ items: [{ id, x, y, w, h }] })` | `table.layout_manage` | Batch in one transaction, sent on drag end or after a size edit. Any unknown or deleted id → `NOT_FOUND`, whole batch rolls back. |
| `delete({ id })` | `table.delete` | Sets `deleted_at`. `PRECONDITION_FAILED` "Unmerge first." when it is a head or a member. `PRECONDITION_FAILED` "Has a booked reservation." when any reservation on it is `booked`. |
| `merge({ headId, memberIds })` | `table.merge` | `memberIds` min 1, must not contain `headId`. All ids live. Head must not be someone's member. Each member must be standalone: not a member, not a head. Otherwise `PRECONDITION_FAILED` "Unmerge first." Sets `merged_into_id = headId` in one transaction. One level only. |
| `unmerge({ id })` | `table.merge` | `id` is a head → null every row pointing at it (group dissolves). `id` is a member → null that row only. Standalone → no-op. |

Zod bounds: `name` 1–20 chars, `seats` int 1–50, `shape` `rect | round`, `x` / `y` int 0–1000,
`w` / `h` int 40–500.

Any id that is unknown or soft-deleted → `NOT_FOUND`, in every procedure that takes one. That
check runs before the `PRECONDITION_FAILED` rules.

Merge never moves tables and unmerge never moves them back; positions are layout, groups are
service. Group capacity is the sum of member seats, computed on read by the client.

### `reservation` router (alias `reservation`)

| Procedure | Permission | Behaviour |
| --- | --- | --- |
| `list({ from, to })` | `reservation.view` | Rows with `starts_at` in `[from, to)`, every status, ordered by `starts_at`. Client passes its local day. Raw rows, no table join; the client already holds `table.list`. |
| `create({ tableId, customerName, phone?, partySize, startsAt, note? })` | `reservation.create` | Table must be live, else `NOT_FOUND`. `created_by = ctx.user.id`, status `booked`. No past-time check, no overlap check. |
| `update({ id, status?, customerName?, phone?, partySize?, startsAt?, note?, tableId? })` | `reservation.update` | Allowed only while `booked`, else `PRECONDITION_FAILED` "Reservation is closed." `status` may become `seated`, `cancelled` or `no_show`. A new `tableId` must be live. |

Zod bounds: `customerName` 1–80, `phone` ≤ 32, `partySize` int 1–100, `note` ≤ 500, `startsAt`
ISO datetime.

### Rules (`floor-rules.ts`, pure)

Same shape as `pin-policy.ts`: no decorators, importable by `node --test`.

- `rejectMerge(headId, memberIds, tables): string | null` — every rule from `merge` above.
- `rejectDelete(table, tables, reservations): string | null` — merged, or has a `booked` reservation.

Services load the rows, call the rule, and throw `PRECONDITION_FAILED` with the returned message.

## 4. Shared client module (`packages/api-contract/src/floor.ts`)

`refresh.ts` already puts shared client logic in this package; `floor.ts` follows. Pure, tested.

```ts
// Structural types, so the package never imports the generated router. `table.list` and
// `reservation.list` rows satisfy them.
export interface FloorTable { id: string; seats: number; w: number; h: number; mergedIntoId: string | null }
export interface FloorReservation { tableId: string; status: string; startsAt: Date | string }

export const FLOOR = { size: 1000, minSide: 40, maxSide: 500 } as const;
export function scaleFor(viewportW: number, viewportH: number): number;   // Math.min(w, h) / FLOOR.size
export function clampPosition(table: { w: number; h: number }, x: number, y: number): { x: number; y: number };
export function groupsOf(tables: FloorTable[]): Map<string, string[]>;    // head id -> member ids
export function seatsOf(headId: string, tables: FloorTable[]): number;    // head + members
export function isReserved(tableId: string, reservations: FloorReservation[], now: Date): boolean;
```

`isReserved` is true when the table has a `booked` reservation with `startsAt <= now + 30 min`.
It stays true until staff mark the reservation `seated`, `no_show` or `cancelled`. The server
stores no badge state.

Exported from `packages/api-contract/src/index.ts`.

## 5. Desktop (`apps/desktop/src/renderer/src/components/`)

- `floor-plan.tsx` — `<div>` positioned relative, sized `FLOOR.size × scale`, scale from the
  container's measured width and height. Each table is an absolute `<div>` (`border-radius: 50%`
  for `round`) showing name, seats (group sum on a head), a "Reserved" badge, and a group outline
  whose colour is keyed by head id.
- **Edit layout** toggle, shown to `table.layout_manage` holders. In edit mode a table drags:
  `onPointerDown` → `setPointerCapture` and remember the pointer offset; `onPointerMove` → local
  x/y in canvas units through `clampPosition`; `onPointerUp` → `table.updateLayout` with that
  table's `x, y, w, h`. Tables carry `touch-action: none`. No drag library.
- Edit mode click on a table opens `table-form.tsx` in a `<dialog>`: name, seats, shape, w, h,
  Save → `table.update` and, if w/h changed, `table.updateLayout`; Delete → `table.delete`
  (shown to `table.delete` holders). "Add table" (`table.create` holders) opens the same form and
  places the new table at `50, 50`. Resizing is by the w/h inputs; no handles.
- Service mode click on a table shows an action row: **Merge** enters pick mode with that table as
  head, clicking other standalone tables toggles them, Confirm → `table.merge`; **Unmerge** →
  `table.unmerge`; **Reserve** opens `reservation-form.tsx` in a `<dialog>` with customer name,
  phone, party size, `<input type="datetime-local">` defaulted to the next full hour, note →
  `reservation.create`.
- Below the plan, today's reservations: table name, time, customer × party, status, and for
  `booked` rows the buttons Seat / No-show / Cancel → `reservation.update`.
- Data: `table.list` and `reservation.list` for the local day, both `refetchInterval` 30 s and
  invalidated after every mutation. A dragged table keeps its local position until the refetch
  confirms it; on error it reverts to the last server position and a `role="alert"` message shows.
- Buttons are hidden by `me.data.permissions`; the server enforces regardless.

`Home` in `app.tsx` renders `<FloorPlan />` under the existing header, only when
`me.data.permissions` includes `table.view`. The reservations list and Reserve button need
`reservation.view` / `reservation.create` in the same way.

## 6. Tablet (`apps/mobile/src/`)

- `app/floor.tsx` — new route; Home gains a "Floor" button, shown when `me` permissions include
  `table.view`. The canvas `View` measures itself with `onLayout` and derives the scale with
  `scaleFor`. Same modes, actions, permission gating and data hooks as desktop.
- `components/floor-table.tsx` — one table. `Gesture.Pan().enabled(editMode)` drives reanimated
  shared values for the live position; `onEnd` runs `runOnJS(commit)` which clamps, updates local
  state and calls `table.updateLayout`. `Gesture.Tap()` opens the action row or the edit form.
  Composed with `Gesture.Exclusive(pan, tap)`. Both libraries are already installed.
- `components/table-form.tsx`, `components/reservation-form.tsx` — modal `View`s with `TextInput`s
  and `react-hook-form` + zod, matching `login.tsx`.
- Reservation time on tablet is two `TextInput`s: date `YYYY-MM-DD` defaulted to today and time
  `HH:mm`, combined into one ISO datetime in the device timezone.
  `ponytail:` no native picker installed; swap for `@expo/ui` DateTimePicker once the dev build
  is in place.
- The idle timer keeps working: the root capture responder in `_layout.tsx` sees the touch start
  before gesture-handler claims it. On the manual checklist.

## 7. Errors

README error-code table gains these rows.

| Code | Means | Client |
| --- | --- | --- |
| `FORBIDDEN` | missing permission | show message; the button was hidden anyway |
| `CONFLICT` | table name in use | keep the form open, show message |
| `PRECONDITION_FAILED` | unmerge first / has a booked reservation / reservation is closed | show message, invalidate `table.list` and `reservation.list` because state changed elsewhere |
| `NOT_FOUND` | table or reservation gone (deleted on another client) | same as above |

A failed drag of any kind reverts to the last server position and shows the message. Two managers
dragging the same table: last write wins, polling reconciles within 30 s.

## 8. Tests

Node 22 `node:test` over pure functions, matching `refresh-window.test.ts`. There is no
Postgres-backed harness (see backlog), so services are not unit-tested.

- `packages/api-contract/src/floor.test.ts` — `clampPosition` at every edge, `groupsOf`,
  `seatsOf`, `isReserved` at 29 and 31 minutes before `startsAt`, and `seated` → false.
- `apps/api/src/floor/floor-rules.test.ts` — table-driven: every `rejectMerge` and
  `rejectDelete` rule from section 3. Added to the api `test` script.
- `apps/api/drizzle/seed/seed-rbac.test.ts` — the two new assertions from section 2.
- Manual checklist for the implementation plan: create, rename, drag on desktop, drag on tablet,
  position appears on the other client within 30 s, merge, unmerge head, unmerge member, delete
  blocked when merged, delete blocked when booked, reservation create / seat / no-show / cancel,
  badge appears 30 min before, idle timer still parks after a drag, waiter gets `FORBIDDEN` on
  create.

## 9. Known ceilings

- No occupancy. Orders do not exist, so a table has no open / occupied state. When orders land:
  an order attaches to the head of a group, and `unmerge` and `delete` gain a "no open order" rule.
- Layout is last-write-wins with 30 s polling. Upgrade path: a tRPC subscription on `table.list`.
- Reservations have no end time, no overlap check, no past-time check.
- The reserved badge is computed on the client clock. A skewed tablet shifts the 30-minute window
  (clock sync is already in the backlog).
- One floor. Areas later are an `area_id` column on `tables` plus tabs on the plan.
- Tablet reservation form uses text date and time inputs.
