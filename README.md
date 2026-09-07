# pos-d4

Turborepo + pnpm monorepo. End-to-end typesafe from Postgres to phone and desktop.

| Workspace               | Stack                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/api`              | NestJS 11, nestjs-trpc, Drizzle ORM + Postgres, Passport JWT (access + rotating refresh), argon2 |
| `apps/mobile`           | Expo SDK 57 + expo-router, tRPC + TanStack Query, Zustand, React Hook Form + Zod                 |
| `apps/desktop`          | electron-vite 5 + React 19, same tRPC/Query/Zustand/RHF client stack                             |
| `packages/api-contract` | `AppRouter` type generated from the Nest routers — the single contract both clients import       |

NestJS is pinned to 11 because `nestjs-trpc@2.13` does not accept Nest 12 yet.

## Setup

```sh
pnpm install
docker compose up -d              # Postgres on :5432
cp apps/api/.env.example apps/api/.env
pnpm db:migrate                   # apply drizzle/0000_*.sql
pnpm db:seed                      # roles, permissions, and the first owner (owner/owner123)
```

> The migrations were squashed into a single `0000_*.sql` while the project is pre-production. A
> database created before the squash cannot migrate forward — drop it and start again:
> `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`.

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

### Mobile profiles and PINs

Tablets are shared. A staff member signs in once with username + password, is made to set a 6-digit
PIN (`auth.setPin`, argon2-hashed in `users.pin_hash`), and from then on re-enters with the
PIN alone. "Sign out" on mobile _parks_ the session: the client keeps the refresh token in its
`profiles` map and calls `auth.park`, which stamps the row `revoked_reason = 'parked'`. A parked
token is refused by `auth.refresh` (only `'rotated'` earns that grace window) and redeemed by
`auth.pinLogin`, which checks the PIN and rotates it into a fresh session — stamping the consumed
row `'pin_rotated'`, a reason only `pinLogin` grants a grace window, so redeeming a profile never
re-opens the PIN-free `refresh` path for the token it just consumed. Removing a profile
calls `auth.logout`, which kills live and parked rows alike. A profile lives `JWT_REFRESH_TTL_DAYS`
from its last PIN login.

Idle detection is client-side only (`apps/mobile/src/hooks/use-idle-timer.ts`): after
`settings.idleTimeoutSeconds` without a touch the tablet parks the session and returns to the
picker. Every cold start parks too. The owner sets the timeout from desktop (`settings.update`,
guarded by the owner-only `settings.manage` permission via `RbacService.require`). There is no
wrong-PIN lockout and no server-side idle guard — deliberate; see the spec's "Known ceilings".

Desktop is unchanged: username + password, no PIN, no idle lock.

### Error codes: `UNAUTHORIZED` vs `FORBIDDEN`

Load-bearing, not cosmetic. Both clients end the session on any `UNAUTHORIZED` — clearing the store
and the query cache, which drops the user back to the login screen. The one exception is
`reason: 'INVALID_PIN'`, below.

| Code                                                     | Means                                                       | Use for                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `UNAUTHORIZED`                                           | we don't know who you are                                   | expired or invalid access token, invalid or revoked refresh token, failed login, wrong PIN       |
| `FORBIDDEN`                                              | we know who you are, you may not do this                    | permission and access-control failures — role checks, manager-only actions, another store's data |
| `UNAUTHORIZED` on `auth.pinLogin`                        | the profile is dead: expired, revoked, no PIN, user deleted | mobile removes the card and asks for the password                                                |
| `UNAUTHORIZED` + `data.reason: 'INVALID_PIN'` on `auth.pinLogin` | the profile is fine, the digits were not             | mobile shows the message, keeps the card, and does not end any session                           |

Returning `UNAUTHORIZED` from a permission check would sign the user out mid-action instead of
showing them a refusal.

### `data.reason`

A wrong PIN is an invalid credential, so it answers `UNAUTHORIZED` (401) like every other failed
credential — which leaves the code unable to say whether the card on screen is still good. That
distinction moves to `data.reason`, set from a `TRPCError`'s string `cause` and put on the wire by
`apps/api/src/trpc/error-formatter.ts` (tRPC does not serialize `cause` on its own). Clients cast to
read it: the generated contract is built without the formatter, so `reason` is absent from the
inferred error type.
