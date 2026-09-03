# pos-d4

Turborepo + pnpm monorepo. End-to-end typesafe from Postgres to phone and desktop.

| Workspace | Stack |
| --- | --- |
| `apps/api` | NestJS 11, nestjs-trpc, Drizzle ORM + Postgres, Passport JWT (access + rotating refresh), argon2 |
| `apps/mobile` | Expo SDK 57 + expo-router, tRPC + TanStack Query, Zustand, React Hook Form + Zod |
| `apps/desktop` | electron-vite 5 + React 19, same tRPC/Query/Zustand/RHF client stack |
| `packages/api-contract` | `AppRouter` type generated from the Nest routers — the single contract both clients import |

NestJS is pinned to 11 because `nestjs-trpc@2.13` does not accept Nest 12 yet.

## Setup

```sh
pnpm install
docker compose up -d              # Postgres on :5432
cp apps/api/.env.example apps/api/.env
pnpm db:migrate                   # apply drizzle/0000_*.sql
```

Set real values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `apps/api/.env` before deploying anywhere.

## Develop

```sh
pnpm --filter @repo/api dev       # Nest on :3333 + tRPC type generation in watch mode
pnpm --filter @repo/mobile dev          # Expo
pnpm --filter @repo/desktop dev   # Electron
```

`apps/api dev` regenerates `packages/api-contract/src/server.ts` on every router change, so both
clients pick up new procedures without a manual step. One-off: `pnpm trpc:generate`.

## Contract flow

`@Router`/`@Query`/`@Mutation` + Zod schemas in `apps/api/src` → `nestjs-trpc generate` →
`packages/api-contract/src/server.ts` → `useTRPC()` in mobile and desktop. Never edit the generated file.

## Schema changes

Edit `apps/api/src/db/schema.ts`, then:

```sh
pnpm db:generate                  # write a migration
pnpm db:migrate                   # apply it
```

## Auth

`auth.register` / `auth.login` return a 15-minute access JWT plus an opaque refresh token stored
SHA-256-hashed in `refresh_tokens`. `auth.refresh` rotates it (the presented token is revoked).
`auth.me` is guarded by `ProtectedMiddleware`, which reuses the same verification path as the
Passport `JwtStrategy` (kept for plain REST controllers via `JwtAuthGuard`).

Clients hold the session in a persisted Zustand store — AsyncStorage on mobile, localStorage on
desktop — and attach the access token in `httpBatchLink`'s `headers()`, which asks
`createTokenProvider` (`packages/api-contract/src/refresh.ts`) for a live one first. It refreshes
30s before `exp`, shares one in-flight refresh across concurrent callers (rotation revokes the
presented token, so a race would log the user out), and ends the session only when the server
actually rejects the credential — a transient failure keeps the session and rejects the request.
`auth.refresh` accepts a token revoked less than 30s ago, so a refresh whose response was lost in
transit becomes a retry rather than a forced logout.

Above the HTTP link sits `createRefreshLink`, which catches the 401s `exp` cannot predict — signing
secret rotated, user deleted, device clock behind — forces one refresh and retries the operation
once. Two layers: `headers()` renews before sending, the link recovers when the server disagrees.
The refresh call goes through a separate client without this link, so it cannot recurse.

### Error codes: `UNAUTHORIZED` vs `FORBIDDEN`

Load-bearing, not cosmetic. Both clients end the session on any `UNAUTHORIZED` — clearing the store
and the query cache, which drops the user back to the login screen.

| Code | Means | Use for |
| --- | --- | --- |
| `UNAUTHORIZED` | we don't know who you are | expired or invalid access token, invalid or revoked refresh token, failed login |
| `FORBIDDEN` | we know who you are, you may not do this | permission and access-control failures — role checks, manager-only actions, another store's data |

Returning `UNAUTHORIZED` from a permission check would sign the user out mid-action instead of
showing them a refusal.
