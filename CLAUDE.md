# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root. pnpm 11, Node >= 22.

```sh
pnpm install
docker compose up -d              # Postgres: `cloud` on :5432, `local` on :5434
cp apps/api/.env.example apps/api/.env
pnpm db:migrate && pnpm db:seed:dev   # roles, permissions, owner/owner123, "Cafe Melati"
```

| Task | Command |
| --- | --- |
| Run API (Nest :3333 + contract generation in watch) | `pnpm api:dev` |
| Run mobile / desktop / backoffice | `pnpm mobile:dev` / `pnpm desktop:dev` / `pnpm backoffice:dev` |
| Desktop with its own API (setup/crash/db-down screens) / against a running `pnpm api:dev` (`DEPLOYMENT=local`) | `pnpm desktop:dev:bundle` / `pnpm desktop:dev` (= `desktop:dev:standalone`) |
| Forget the desktop's DB config (setup screen again) / also wipe the bundled Postgres data | `pnpm desktop:hub-reset` / `pnpm desktop:hub-reset all` (quit the app first) |
| All tests / types / lint | `pnpm test`, `pnpm check-types`, `pnpm lint` |
| API tests only | `pnpm api:test` |
| One API test file | `pnpm --filter @repo/api exec vitest run src/outlet/outlet.service.test.ts` |
| One API test by name | `pnpm --filter @repo/api exec vitest run -t 'stored uppercase'` |
| Contract package tests | `pnpm --filter @repo/api-contract test` |
| Regenerate the tRPC contract | `pnpm trpc:generate` |
| Migration after a schema edit | `pnpm db:generate` then `pnpm db:migrate` |

`seedRbac` lives in `src/role/seed-rbac.ts` and runs on every `local` boot after the migrations (`migrateDatabase`). Seeds: `pnpm db:seed` = roles and permissions only (every cloud deploy, after `db:migrate`); `pnpm db:seed:dev` = that plus owner/owner123 and "Cafe Melati" (dev only; the setup wizard then never shows); `pnpm prod:init` = the first owner of a fresh cloud database, prompted, no outlet (the owner adds outlets in the backoffice), refused once an owner exists and unless `DEPLOYMENT=cloud`.

Formatting is Prettier at the root (`pnpm format`, single quotes, 110 cols) — no per-app formatter.

## Architecture

Turborepo + pnpm monorepo, end-to-end typesafe from Postgres to both clients.

- `apps/api` — NestJS 11 (pinned; `nestjs-trpc@2.13` rejects Nest 12), nestjs-trpc, Drizzle ORM on node-postgres, Passport JWT, argon2.
- `apps/mobile` — Expo SDK 57 + expo-router, NativeWind. Shared tablet: password login once, then 6-digit PIN.
- `apps/desktop` — electron-vite + React 19. Signs in with username + password; no PIN profile picker. A user without a PIN gets the forced "Buat PIN" screen right after that login, as on the tablet (no skip; "Keluar" signs out). The account menu (the profile block) has "Ubah PIN" and "Ubah password" — no "Buat PIN". Locking ("Kunci" or `desktop_lock_seconds` idle) **parks** the session like mobile's sign-out: `park()` drops the access token, the parked token stays in the store's `refreshToken` (`setSession` ignores sessions landing while parked), and the lock screen's keypad reopens it with the PIN via `auth.pinLogin`. A user who somehow has no PIN keeps the session and unlocks with the password via `auth.unlock` (a wrong one is `FORBIDDEN`, never 401). The app unmounts behind the lock screen; "Ganti pengguna" logs out. Main supervises the hub (US-002): `src/main/hub.ts` probes the Postgres in `userData/hub.json` (secrets via `safeStorage`), forks `apps/api/dist/main.js` with `utilityProcess` in `DEPLOYMENT=local` (the API migrates itself on boot and serves `GET /health`), and pushes `starting | setup | ready | db-down | crashed` to the renderer's `HubGate`; the app mounts only at `ready`. Signed out on a hub with no outlet (`setup.status`), the app shows `SetupWizard` (US-088): first outlet plus global owner with password and PIN via the public, loopback-only `setup.run`, then `auth.login`. It is refused once any outlet row exists. The renderer's API URL comes from main (`window.hub.apiUrl`, `127.0.0.1`). `DESKTOP_EXTERNAL_API=1` skips the spawn (use with `pnpm api:dev` on `DEPLOYMENT=local`).
- `apps/backoffice` — React Router 7 + React 19 admin web app (`app/routes/*`): login, outlet switcher, outlets, staff, roles, settings, categories, menu, add-ons. Always online, cloud only.
- `packages/ui` — web components (`Button`, `Card`, `Alert`, `TextField`) shared by desktop and backoffice. Source `.tsx` exported directly, no build step; consumers must add `../../packages/ui/src/**/*.{js,ts,jsx,tsx}` to their Tailwind `content` globs. Mobile has its own RN mirrors.
- `packages/api-contract` — the `AppRouter` type both clients import, plus the *shared runtime* pieces: `refresh.ts` (token provider), `refresh-link.ts` (401 recovery link), `floor.ts` (floor-plan geometry/rules), `id.ts` (`uuidv7()` for client-generated ids; mobile passes expo-crypto bytes, React Native has no `crypto.getRandomValues`). Also `eslint-config`, `typescript-config`, `tailwind-config`.

### The contract flow

`@Router`/`@Query`/`@Mutation` + Zod schemas in `apps/api/src` → `nestjs-trpc generate` → `packages/api-contract/src/server.ts` → `useTRPC()` in both clients. `server.ts` is **generated and committed** — never hand-edit it; `pnpm api:dev` rewrites it on every router change.

**Every Zod bound in a decorator must be an inline literal.** The generator cannot hoist an identifier a schema references, so `z.string().max(NAME_MAX)` breaks generation — write `z.string().max(60)`.

### Module shape

Each domain (`auth/`, `floor/`, `outlet/`, `settings/`, `category/`, `menu/`, `addon/`, `audit/`, `sync/`, `setup/`) is three layers:

1. `*.router.ts` — decorators, Zod validation, `@UseMiddlewares(ProtectedMiddleware)`, and `rbac.require(ctx.user.id, 'domain.action')`. Thin. (`setup` is the exception: public, loopback-only, `local` hub only.)
2. `*.service.ts` — the Drizzle work, constructor-injected `DRIZZLE` handle.
3. `*-rules.ts` — pure, decorator-free functions holding the logic worth testing (`floor-rules.ts`, `pin-policy.ts`, `refresh-window.ts`, `rbac-rules.ts`, `outlet-rules.ts`, `category-rules.ts`, `menu-rules.ts`, `addon-rules.ts`, `audit-rules.ts`, `setup-rules.ts`). They exist so tests can import them without Nest's DI or reflect-metadata.

**Audit log** (US-011): every config/catalogue mutation calls `audit(tx, actor, {...})` from `src/audit/audit.ts` inside the same transaction as its write, so the row commits or rolls back with the change. One `audit_log` table for all modules (`module` + `action` = `module.verb`); `before`/`after` keep only changed fields with secrets masked, and an unchanged save writes nothing. The table is append-only by DB trigger. New money/correction features add their module to `AUDIT_MODULES` (schema) and to the inline enum in `audit.router.ts`.

**Sync events** (US-012): the outbox the hub's sync service pushes to the cloud (US-049). Every transactional create goes through `createOnce(tx, actor, table, values, { outletId, type })` from `src/sync/sync-event.ts`: the client sends the row's id (`uuidv7()`, minted once per create attempt so an approval retry reuses it), a repeat returns the stored row (an id stored at another outlet is `CONFLICT`), and the row plus its `sync_events` row (payload = full row, type `entity.verb` per PRD Appendix C) commit together; other transactional writes call `recordSyncEvent(tx, …)` in their transaction. Reservations are the first user (`reservation.upserted` on create and update). Only `synced_at` may change after insert (DB trigger). `sync.pendingCount` is the unsynced count for the active outlet. Not the same as `audit_log` (people-facing who/why) or the LAN `menu.changed` broadcasts.

Permission checks are by *name* (`domain.action`), never id. Effective permissions = role grants + per-user `grant` rows − per-user `revoke` rows (`rbac-rules.ts`).

### Auth

Access JWT (15 min) + opaque refresh token stored SHA-256-hashed in `refresh_tokens`, rotated on use. Two layers on the client: `createTokenProvider` renews 30s before `exp` and shares one in-flight refresh across callers; `createRefreshLink` sits above the HTTP link and retries once on the 401s `exp` cannot predict. The refresh call goes through a separate link-less client so it cannot recurse.

`auth.setPin`: a first PIN needs no password only within `FIRST_PIN_WINDOW_MS` (5 min) of a password login — the access token carries `pwd: true` only when `auth.login` minted it, and `ctx.passwordAt` is its `iat`. Otherwise, and for changing an existing PIN, the password is required; a sent password is always checked. A missing one is `FORBIDDEN` + `data.reason: 'NEEDS_PASSWORD'` (`needsPassword` from `@repo/api-contract`), and both first-run screens then show their password field. A PIN is also an approval credential (US-010), so a session left open must never mint one. Mobile "sign out" and the desktop lock **park** the session (`revoked_reason = 'parked'`); mobile keeps the token in its `profiles` map, desktop in the store's `refreshToken`. `auth.pinLogin` redeems it. Only `'rotated'` and `'pin_rotated'` reasons earn the 30s grace window in `auth.refresh` — that asymmetry is what stops a parked profile from reopening the PIN-free refresh path.

A session carries an **active outlet** (`outletId` in the JWT and on the `refresh_tokens` row). Roles are per outlet (`outlet_staff.role_id`); `users.role_id` is the *global* role, owner only, needing no membership. `auth.refresh` with an `outletId` is the outlet picker — there is no `selectOutlet`. `rbac.require(ctx, permission)` reads the role for `ctx.outletId`; `canActOn(ctx, outletId)` confines a non-global user to their active outlet. Refusals are `FORBIDDEN`: `Outlet tidak ditemukan.` for an outlet you do not work at (refresh) or may not act on (`canActOn`) — same text as a real `NOT_FOUND`, but still 403 — and `Anda tidak memiliki akses.` from `rbac.require`; `setStaff` with the owner role is `BAD_REQUEST` `Owner is global.`

### Menu

The **menu is per outlet**: each outlet has its own menu, brand and settings (PRD v2 section 12, 2026-10-01), so `categories`, `menu_items`, `addon_groups` and `kitchen_stations` carry `outlet_id`, names are unique per outlet, and every catalogue procedure works on the session's active outlet (`activeOutlet(ctx)`, never an outlet id from input). An item's category, station and add-on groups must be of the same outlet (`NOT_FOUND` otherwise). `menu.list` returns the active outlet's `{ categories, items, addonGroups }` in one call. `menu_items.active` is the admin on/off switch; sold-out (`item_availability`, US-018) is not built yet. `kitchen_stations` has no router yet: `effectiveStationId` in `menu-rules.ts` resolves item-over-category, and US-036 adds printer/KDS. Who edits a menu is the `menu.manage`/`category.edit` permission — the outlet Manager by default, movable per user with overrides.

### Error codes are load-bearing

Both clients end the session on **any** `UNAUTHORIZED` — store cleared, query cache dropped, back to login. So:

- `UNAUTHORIZED` = we don't know who you are (bad credential, dead token).
- `FORBIDDEN` = we know you, you may not do this (every permission/access-control refusal). Returning `UNAUTHORIZED` from a permission check signs the user out mid-action.
- A wrong PIN is `UNAUTHORIZED` + `data.reason: 'INVALID_PIN'` — the one 401 clients do not act on.
- A login lock is `FORBIDDEN` + `data.reason: 'LOCKED'` (US-005/US-006): five wrong passwords in 15 min lock `auth.login` and every other password check — `setPin`, `changePassword`, `unlock` — for 15 (`verifyPassword`; a wrong one there is `FORBIDDEN`, not 401); five wrong PINs in 10 min lock `auth.pinLogin` for 10. Separate counters, and neither is the approval block. Clients show the "Terlalu banyak percobaan gagal" dialog (`isLocked`, `LOCKED_DIALOG` from `@repo/api-contract`).
- A permission refusal a manager can lift is `FORBIDDEN` + `data.reason: 'NEEDS_APPROVAL'` (US-010). Overridable mutations take optional `approval: { approverUserId, pin, reason? }` and call `rbac.requireOrApprove(ctx, permission, input.approval)` instead of `rbac.require`; the service writes `auditApproval(tx, approved, entityType, entityId)` in its transaction. Clients wrap them in `useApproval` from `@repo/hooks/use-approval` (`run` = server first, `request` = check first) plus each app's `<ApprovalDialog>`. Wrong approval PINs count against the requester, never the approver: five in ten minutes block that user from every override for ten (`approval.blocked` audit row; a manager clears it early with `approval.unblock` from the Staff page, audited `approval.unblocked`). `auth.pinLogin` keeps its own five-in-ten lock on the user's own PIN (`verifyPin`). All answered `FORBIDDEN`. `createRefreshLink` never retries an `INVALID_PIN` 401 — the handler ran and counted it.

`data.reason` comes from a `TRPCError`'s string `cause`, put on the wire by `apps/api/src/trpc/error-formatter.ts` (tRPC does not serialize `cause`). The generated contract is built without the formatter, so clients must cast to read `reason`.

The floor (`tables`, `reservations`) is per outlet like the menu: every floor procedure works on `activeOutlet(ctx)`, table names are unique per outlet. Also load-bearing on the floor domain: `CONFLICT` (duplicate live name), `PRECONDITION_FAILED` (`Unmerge first.`, `Has a booked reservation.`, `Reservation is closed.`), `NOT_FOUND` — all mean "state changed elsewhere, show the message and refetch".

### Testing

`apps/api` uses vitest with a **glob** (`src/**/*.test.ts`, `drizzle/**/*.test.ts`) and `sequence.concurrent: false`. Database-touching tests get their own database — `connectTestDatabase()` in `src/test/test-db.ts` derives it by suffixing `DATABASE_URL` with `_test`, creates and migrates it on first use, and `truncateAll()` clears between cases. They instantiate services directly (`new OutletService(db)`); Nest DI is not involved.

`packages/api-contract` still runs `node --test` with an **explicit file list** in its `package.json` — a new `*.test.ts` there does not run until it is added to that script.

Three files now truncate that one shared `_test` database, so `vitest.config.ts` sets `fileParallelism: false` — tests inside a file are serialized too (`sequence.concurrent: false`).

## Domain: F&B POS

This is a point-of-sale system for food & beverage outlets (dine-in with floor plans and reservations,
multi-outlet, shared staff tablets). UI copy is Indonesian. Money, orders and audit trails are what a
POS is judged on — apply these rules to every feature that touches them, including ones not built yet:

- **Money is integer minor units** (`integer`/`bigint` rupiah), never `float`/`real`. Round once, at a
  defined step (line → discount → service charge → tax → total), and keep that order in a pure
  `*-rules.ts` function with tests. Tax and service-charge rates live in data, not code.
- **Financial records are append-only.** A sent order line, payment, or closed bill is never updated or
  hard-deleted: correct it with a void/refund/adjustment row carrying who, when, and a reason. Soft
  delete (`deleted_at`) is for catalogue/config data (tables, menu items), not transactions.
- **Snapshot at sale time.** An order line stores the item name, price, modifiers and tax rate it was
  sold with — later menu edits must not rewrite history or reprints.
- **Voids, refunds, discounts, price overrides and reopening a closed bill are permission-gated**
  (`rbac.require`) and audited; a manager override records both the cashier and the approver.
- **Idempotency on every money-moving mutation.** Tablets retry on flaky Wi-Fi; a double tap or a
  retried request must not create a second payment or duplicate order. Accept a client-generated
  id/idempotency key and make the write a no-op on repeat.
- **Concurrency is normal**: several tablets edit the same table/bill. Guard state transitions in the DB
  (conditional `UPDATE ... WHERE status = ...`, unique constraints, transactions) and answer a lost race
  with `CONFLICT`/`PRECONDITION_FAILED` so the client refetches — never last-write-wins on a bill.
- **Business day ≠ calendar day.** Reports, shift/cash-drawer close and order numbering group by the
  outlet's business date (service past midnight belongs to the previous day). Store `timestamptz`,
  derive the business date with the outlet's timezone and cut-off.
- **Everything is outlet-scoped.** Every transactional row carries `outlet_id`, and every query filters
  by it via `canActOn` — never trust an outlet id from input without that check.
- **Connectivity differs per app.**
  - `apps/mobile` and `apps/desktop` are **offline-first** — the counter and floor apps. Service cannot
    stop when the internet drops (hence the planned `local` deployment). Design their write paths so they
    run against a local server and sync later: client-generated ids, queued writes, no reliance on
    cloud-only state mid-transaction, and UI that shows sync state rather than failing.
  - `apps/backoffice` is **always online** — admin/reporting against the cloud API. No offline queue or
    local cache-as-truth there; a network failure is simply an error to show and retry.
- **Speed at the counter.** Cashier/waiter screens are touch-first: large hit targets, minimal taps per
  order, no blocking spinners on the order path, and every error message says what to do next.

## Conventions

- Commits: conventional, lowercase (`feat:`, `fix:`, `refactor:`, `chore:`). **Do not commit or create branches/worktrees** — the user works on `main` and commits themselves; leave changes in the working tree.
- Specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`, dated. Read the matching spec before touching a feature it covers; it records the deliberate omissions ("Known ceilings") so they don't get "fixed" by accident.
- Migrations were squashed to `0000_*.sql` pre-production. A database older than the squash cannot migrate forward: `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed:dev`.
- TypeScript versions differ per workspace on purpose — Expo pins mobile's toolchain, and each app's
  bundler dictates its own (mobile TS 6, api/desktop TS 5.9, backoffice TS 6 on Vite 8). Do not try to
  unify them.
- `DEPLOYMENT` (`cloud` / `local` / `all`) in `apps/api/.env` is required at boot and decides which domain modules mount (`MOUNTS` in `src/deployment-rules.ts`, applied by `AppModule.register`): `cloud` = backoffice set (no floor/sync), `local` = mobile/desktop hub set (no audit; also mounts `setup`). `all` refuses to boot. Contract generation is static and ignores it. One API process cannot serve both backoffice and the POS apps — run `cloud` and `local` side by side on different ports when you need both.
- **Long lists are virtualized.** Web (`packages/ui` select/combobox options, backoffice and desktop lists) uses `@tanstack/react-virtual`; mobile uses `@shopify/flash-list` instead of `FlatList`/`ScrollView` + `map`. Applies to any list that can grow unbounded (menu items, staff, add-on options, search results); short fixed lists (tax types, order types) stay plain. Neither package is installed yet — add it to the workspace that first needs it.

## Responses

Every reply you have to call me "onii-chan".
