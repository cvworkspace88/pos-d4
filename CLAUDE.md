# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root. pnpm 11, Node >= 22.

```sh
pnpm install
docker compose up -d              # Postgres: `cloud` on :5432, `local` on :5434
cp apps/api/.env.example apps/api/.env
pnpm db:migrate && pnpm db:seed   # seeds roles, permissions, owner/owner123
```

| Task | Command |
| --- | --- |
| Run API (Nest :3333 + contract generation in watch) | `pnpm api:dev` |
| Run mobile / desktop / backoffice | `pnpm mobile:dev` / `pnpm desktop:dev` / `pnpm backoffice:dev` |
| All tests / types / lint | `pnpm test`, `pnpm check-types`, `pnpm lint` |
| API tests only | `pnpm api:test` |
| One API test file | `pnpm --filter @repo/api exec vitest run src/outlet/outlet.service.test.ts` |
| One API test by name | `pnpm --filter @repo/api exec vitest run -t 'stored uppercase'` |
| Contract package tests | `pnpm --filter @repo/api-contract test` |
| Regenerate the tRPC contract | `pnpm trpc:generate` |
| Migration after a schema edit | `pnpm db:generate` then `pnpm db:migrate` |

Formatting is Prettier at the root (`pnpm format`, single quotes, 110 cols) — no per-app formatter.

## Architecture

Turborepo + pnpm monorepo, end-to-end typesafe from Postgres to both clients.

- `apps/api` — NestJS 11 (pinned; `nestjs-trpc@2.13` rejects Nest 12), nestjs-trpc, Drizzle ORM on node-postgres, Passport JWT, argon2.
- `apps/mobile` — Expo SDK 57 + expo-router, NativeWind. Shared tablet: password login once, then 6-digit PIN.
- `apps/desktop` — electron-vite + React 19. Username + password only, no PIN, no idle lock.
- `apps/backoffice` — Vite 8 + React 19 admin web app. Scaffold only so far: no tRPC client, no auth.
- `packages/ui` — web components (`Button`, `Card`, `Alert`, `TextField`) shared by desktop and backoffice. Source `.tsx` exported directly, no build step; consumers must add `../../packages/ui/src/**/*.{js,ts,jsx,tsx}` to their Tailwind `content` globs. Mobile has its own RN mirrors.
- `packages/api-contract` — the `AppRouter` type both clients import, plus the *shared runtime* pieces: `refresh.ts` (token provider), `refresh-link.ts` (401 recovery link), `floor.ts` (floor-plan geometry/rules). Also `eslint-config`, `typescript-config`, `tailwind-config`.

### The contract flow

`@Router`/`@Query`/`@Mutation` + Zod schemas in `apps/api/src` → `nestjs-trpc generate` → `packages/api-contract/src/server.ts` → `useTRPC()` in both clients. `server.ts` is **generated and committed** — never hand-edit it; `pnpm api:dev` rewrites it on every router change.

**Every Zod bound in a decorator must be an inline literal.** The generator cannot hoist an identifier a schema references, so `z.string().max(NAME_MAX)` breaks generation — write `z.string().max(60)`.

### Module shape

Each domain (`auth/`, `floor/`, `outlet/`, `settings/`) is three layers:

1. `*.router.ts` — decorators, Zod validation, `@UseMiddlewares(ProtectedMiddleware)`, and `rbac.require(ctx.user.id, 'domain.action')`. Thin.
2. `*.service.ts` — the Drizzle work, constructor-injected `DRIZZLE` handle.
3. `*-rules.ts` — pure, decorator-free functions holding the logic worth testing (`floor-rules.ts`, `pin-policy.ts`, `refresh-window.ts`, `rbac-rules.ts`, `outlet-rules.ts`). They exist so tests can import them without Nest's DI or reflect-metadata.

Permission checks are by *name* (`domain.action`), never id. Effective permissions = role grants + per-user `grant` rows − per-user `revoke` rows (`rbac-rules.ts`).

### Auth

Access JWT (15 min) + opaque refresh token stored SHA-256-hashed in `refresh_tokens`, rotated on use. Two layers on the client: `createTokenProvider` renews 30s before `exp` and shares one in-flight refresh across callers; `createRefreshLink` sits above the HTTP link and retries once on the 401s `exp` cannot predict. The refresh call goes through a separate link-less client so it cannot recurse.

Mobile "sign out" **parks** the session (`revoked_reason = 'parked'`) and keeps the refresh token in the client's `profiles` map; `auth.pinLogin` redeems it. Only `'rotated'` and `'pin_rotated'` reasons earn the 30s grace window in `auth.refresh` — that asymmetry is what stops a parked profile from reopening the PIN-free refresh path.

A session carries an **active outlet** (`outletId` in the JWT and on the `refresh_tokens` row). Roles are per outlet (`outlet_staff.role_id`); `users.role_id` is the *global* role, owner only, needing no membership. `auth.refresh` with an `outletId` is the outlet picker — there is no `selectOutlet`. `rbac.require(ctx, permission)` reads the role for `ctx.outletId`; `canActOn(ctx, outletId)` confines a non-global user to their active outlet. Refusals are `FORBIDDEN`: `Not assigned to this outlet.`, `Wrong outlet.`; `setStaff` with the owner role is `BAD_REQUEST` `Owner is global.`

### Error codes are load-bearing

Both clients end the session on **any** `UNAUTHORIZED` — store cleared, query cache dropped, back to login. So:

- `UNAUTHORIZED` = we don't know who you are (bad credential, dead token).
- `FORBIDDEN` = we know you, you may not do this (every permission/access-control refusal). Returning `UNAUTHORIZED` from a permission check signs the user out mid-action.
- A wrong PIN is `UNAUTHORIZED` + `data.reason: 'INVALID_PIN'` — the one 401 clients do not act on.

`data.reason` comes from a `TRPCError`'s string `cause`, put on the wire by `apps/api/src/trpc/error-formatter.ts` (tRPC does not serialize `cause`). The generated contract is built without the formatter, so clients must cast to read `reason`.

Also load-bearing on the floor domain: `CONFLICT` (duplicate live name), `PRECONDITION_FAILED` (`Unmerge first.`, `Has a booked reservation.`, `Reservation is closed.`), `NOT_FOUND` — all mean "state changed elsewhere, show the message and refetch".

### Testing

`apps/api` uses vitest with a **glob** (`src/**/*.test.ts`, `drizzle/**/*.test.ts`) and `sequence.concurrent: false`. Database-touching tests get their own database — `connectTestDatabase()` in `src/test/test-db.ts` derives it by suffixing `DATABASE_URL` with `_test`, creates and migrates it on first use, and `truncateAll()` clears between cases. They instantiate services directly (`new OutletService(db)`); Nest DI is not involved.

`packages/api-contract` still runs `node --test` with an **explicit file list** in its `package.json` — a new `*.test.ts` there does not run until it is added to that script.

Three files now truncate that one shared `_test` database, so `vitest.config.ts` sets `fileParallelism: false` — tests inside a file are serialized too (`sequence.concurrent: false`).

## Conventions

- Commits: conventional, lowercase (`feat:`, `fix:`, `refactor:`, `chore:`). **Do not commit or create branches/worktrees** — the user works on `main` and commits themselves; leave changes in the working tree.
- Specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`, dated. Read the matching spec before touching a feature it covers; it records the deliberate omissions ("Known ceilings") so they don't get "fixed" by accident.
- Migrations were squashed to `0000_*.sql` pre-production. A database older than the squash cannot migrate forward: `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`.
- TypeScript versions differ per workspace on purpose — Expo pins mobile's toolchain, and each app's
  bundler dictates its own (mobile TS 6, api/desktop TS 5.9, backoffice TS 6 on Vite 8). Do not try to
  unify them.
- `DEPLOYMENT` (`cloud` / `local` / `all`) in `apps/api/.env` is designed but not yet read by any code — it will decide which router modules a process exposes (`all` is for `trpc:generate` only, never for a running server).

## Responses

Every reply you have to call me "Sir".
