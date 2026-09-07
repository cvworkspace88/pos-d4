# Mobile PIN Profiles — Design

**Date:** 2026-09-04
**Status:** approved in brainstorming, awaiting implementation plan

## Goal

Shared on-site tablets hold several staff profiles. A staff member signs in once with username +
password, sets a PIN, and from then on re-enters with their PIN only. Signing out keeps the profile
on the tablet. Idle tablets drop back to the profile picker automatically after an owner-configured
timeout. Desktop keeps plain username + password sign-in and gains a small settings block for the
timeout. PIN stays optional at the account level: only users who sign in on mobile ever set one.

## Non-goals

- PIN as a second factor at password login.
- PIN-based manager approval for `*_approve` permissions (future work; `RbacService.require` built
  here is the hook for it).
- Manager/owner reset of another user's PIN (needs a user-admin screen that does not exist).
- Desktop PIN or desktop idle lock.
- Several simultaneously active users on one tablet. One active, the rest parked.

## Core idea: a profile is a parked refresh token

The tablet already holds a refresh token per signed-in user. "Sign out, keep profile" parks that
token instead of revoking it: the server marks the row `revoked_reason = 'parked'`, which makes
`auth.refresh` reject it (only `'rotated'` earns the grace window — existing behaviour) while a new
`auth.pinLogin` accepts it together with the user's PIN and rotates it into a fresh session. No new
token type, no new table. A profile lives `JWT_REFRESH_TTL_DAYS` (30) from its last PIN login.

Refresh-token row lifecycle:

```
issue ──► live ──(auth.park)──► parked ──(auth.pinLogin + PIN)──► pin_rotated ──► new live row
           │                      │
           └──(auth.logout)───────┴──► logout        (dead, no grace)
```

## 1. Server (`apps/api`)

### Migrations: squash

Pre-production, so the three existing migrations are squashed. Delete `drizzle/0000_*.sql`,
`0001_*.sql`, `0002_*.sql` and `drizzle/meta/`, then `pnpm db:generate` produces one fresh
`0000_*.sql` from `schema.ts` containing every table below. Dev database reset:
`docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed`. README setup
instructions remain valid.

### Schema (`src/db/schema.ts`)

- `users.pin_hash text` nullable — argon2 hash of a 6-digit PIN. `NULL` = no PIN.
- `refresh_tokens.revoked_reason` TypeScript type widens to
  `'rotated' | 'logout' | 'parked' | 'pin_rotated'`. Text column, no SQL change.
- `settings` single-row typed table: `id integer primary key default 1` with `CHECK (id = 1)`,
  `idle_timeout_seconds integer not null default 120`, `updated_at`. No seed row: `settings.get`
  returns code defaults when the row is absent; `settings.update` upserts row 1. A future setting
  is a new column.

### PIN policy (`src/auth/pin-policy.ts`, pure, testable)

Same shape as `refresh-window.ts`: no decorators so `node --test` can import it.

- PIN format `/^\d{6}$/` is a regex literal inside the router's zod schema and again in the
  mobile form schema. Not a shared constant: the nestjs-trpc generator hoists zod schemas but not
  arbitrary identifiers they reference, and mobile cannot import from `apps/api`.
- `rejectPinLogin(row, now)`: expired rejects first; live and `parked` rows pass; a `pin_rotated`
  row passes for `REVOKE_GRACE_MS`; anything else defers to `rejectRefresh`. So `logout`,
  rotated-past-grace and expired rows reject.
- The `pin_rotated` grace lives here and NOT in `rejectRefresh`, deliberately. A PIN login whose
  response was lost has to become a retry, but the retry must be another `pinLogin` — one that asks
  for the PIN again. Stamping the redeemed row plain `rotated` would let `rejectRefresh` hand that
  same token a PIN-free session for the length of the window, so every legitimate PIN login would
  briefly undo the parking it had just redeemed.

### `auth` router changes (`src/auth/auth.router.ts`, `auth.service.ts`)

Shared `userOutput` zod schema replaces the four inline `{ id, name, username }` copies and gains
`hasPin: z.boolean()` (`Boolean(user.pinHash)`, set wherever a user is serialised: `issueSession`
and `ProtectedMiddleware`'s ctx). `me` additionally returns `permissions: z.array(z.string())`.

| Procedure | Auth | Change |
| --- | --- | --- |
| `register`, `refresh` | public | Output shape only (`hasPin`). |
| `logout({ refreshToken })` | public | Predicate widens to `revoked_at IS NULL OR revoked_reason = 'parked'`. Today it would no-op on a parked row and a removed profile would stay usable. |
| `park({ refreshToken })` | public | New. Sets `revoked_at = now(), revoked_reason = 'parked'` on the un-revoked row matching the hash — idempotent, a parked row is left alone so its timestamp cannot slide. A user with no `pin_hash` is stamped `'logout'` instead: parking them would leave a card that can never be tapped and a row neither endpoint can clear. Client calls it fire-and-forget like `logout`. |
| `pinLogin({ refreshToken, pin })` | public | New. Steps below. |
| `setPin({ pin, password? })` | protected | New. `pin` must match `/^\d{6}$/`. `password` is required when `pin_hash` is already set (changing), optional on first set — the user just signed in and the bearer token proves identity. Stores argon2 hash. Returns `userOutput` (now `hasPin: true`) so the client can update its stored user without a new session. |
| `me` | protected | Adds `hasPin`, `permissions`. |

`pinLogin` steps:

1. Load the row by `sha256(refreshToken)`. `rejectPinLogin` non-null → `UNAUTHORIZED` "Profile expired."
2. Load the user (`deleted_at IS NULL`). Missing → `UNAUTHORIZED`.
3. `checkPin(user, pin)` (service method; only caller today, kept separate so a future
   manager-approval gate can reuse it):
   - `pin_hash` null → `UNAUTHORIZED` "Sign in with password."
   - `argon2.verify` fails → `FORBIDDEN` "Wrong PIN." No attempt counter, no lockout.
4. Rotate the row (`revoked_at = now(), revoked_reason = 'pin_rotated'` where `id` matches and the
   row is alive) and `issueSession(user)`.

"Alive" throughout means `revoked_at IS NULL OR revoked_reason = 'parked'`; one drizzle helper
expression, used by `logout`, `park` and `pinLogin`.

Error code contract (README table gains these rows):

| Code | On `pinLogin` means | Client does |
| --- | --- | --- |
| `FORBIDDEN` | wrong PIN | show message, keep the card |
| `UNAUTHORIZED` | profile is dead: expired, token revoked, no PIN, user deleted | remove the card, send to password sign-in |

### RBAC check (`src/auth/rbac.service.ts`)

First real permission gate in the repo. `RbacService`, provided and exported by `AuthModule`:

- `permissionsOf(userId): Promise<string[]>` — `users` → `role_permissions` → `permissions.name`.
  Empty array for a user with no role.
- `require(userId, permission): Promise<void>` — throws `FORBIDDEN` when absent.

Called inline in handlers (`await this.rbac.require(ctx.user.id, 'settings.manage')`) rather than as
a parameterised nestjs-trpc middleware, which the library does not support cleanly.

### Seed (`drizzle/seed/seed-rbac.ts`)

- New permission `'settings.manage': []`.
- New `OWNER_ONLY = new Set(['settings.manage'])`. `holdersOf` returns `['owner']` for these and
  `['owner', 'manager', ...]` for everything else. Header comment updated: manager holds everything
  except `OWNER_ONLY`.

### `settings` router (`src/settings/settings.module.ts`, `settings.router.ts`, `settings.service.ts`)

| Procedure | Auth | Behaviour |
| --- | --- | --- |
| `get` | protected | `{ idleTimeoutSeconds }`. Row absent → `{ idleTimeoutSeconds: 120 }`. |
| `update({ idleTimeoutSeconds })` | protected + `settings.manage` | `int().min(30).max(3600)`. Upsert row 1. Returns the new value. |

`SettingsModule` imports `AuthModule` for `ProtectedMiddleware` and `RbacService`; `AppModule`
registers it. `pnpm trpc:generate` regenerates the contract.

## 2. Mobile state (`apps/mobile/src/lib/stores/auth.ts`)

```ts
interface Profile { user: Session['user']; refreshToken: string }

interface AuthState {
  // active session (one at a time)
  user: Session['user'] | null;
  accessToken: string | null;
  refreshToken: string | null;
  // parked profiles on this tablet, keyed by user id
  profiles: Record<string, Profile>;
  hydrated: boolean;

  setHydrated(): void;
  setSession(session: Session): void;   // sets active AND upserts profiles[user.id] with the new refreshToken
  setUser(user: Session['user']): void; // after setPin: active user + profile entry
  park(): void;                          // local only: profiles[user.id] refreshed, active -> null
  removeProfile(userId: string): void;  // local only
  clear(): void;                         // active -> null only (UNAUTHORIZED chokepoint, token provider)
}
```

The store never imports `trpcClient` (`trpc.ts` imports the store — a cycle). Server calls live in
`apps/mobile/src/lib/session.ts`, the home of today's `signOut` logic:

- `park()` — reads the active refresh token, calls `store.park()`, then `auth.park` fire-and-forget.
- `removeProfile(userId)` — `auth.logout` fire-and-forget with the profile's token, then
  `store.removeProfile`.

Screens and the idle hook call `lib/session.ts`, never the store's `park`/`removeProfile` directly.

- `setSession` upserts the profile on every rotation, so the profile always holds the live token
  even if the app dies before `park` runs.
- `park` is the only "sign out" on mobile. It mirrors `signOut` today: local state first, server
  call fire-and-forget. The store-subscription chokepoint in `trpc.ts` still clears the query cache
  because `accessToken` goes non-null → null.
- `onRehydrateStorage`: an active session found in storage is parked locally (`store.park()`) before
  `hydrated` flips, so no screen ever renders the old session. Every cold start lands on the profile
  picker and a restarted tablet always asks for a PIN. The server-side `park` is skipped here (the
  store cannot reach `trpcClient`); the row stays plain-refreshable until the next `pinLogin`
  rotates it — covered by the first ceiling in section 5.
- `partialize` persists `user`, `accessToken`, `refreshToken`, `profiles`.
- `createTokenProvider` wiring in `trpc.ts` is unchanged; it only touches the active session.

### Idle (`apps/mobile/src/hooks/use-idle-timer.ts`, mounted in `app/_layout.tsx`)

- Root `View` with `onStartShouldSetResponderCapture={() => { bump(); return false; }}` records
  `lastActive` without stealing touches.
- A `setTimeout` reset on each bump fires `park()` after the timeout.
- `AppState` change to `active` compares `Date.now() - lastActive` against the timeout and parks if
  exceeded — JS timers do not run while the app is backgrounded.
- Timeout comes from `settings.get` (query enabled only while a session is active, `staleTime`
  5 minutes), falling back to `120` seconds until loaded. Nothing runs when there is no session.

## 3. Mobile screens (`apps/mobile/src/app`)

| Route | Change |
| --- | --- |
| `index.tsx` | No active session → `<Redirect href="/profiles" />` (was `/login`). Active session with `user.hasPin === false` → `<Redirect href="/set-pin" />`. "Sign out" button calls `park()` from `lib/session.ts`. |
| `profiles.tsx` (new) | Grid of profile cards (name). Tap → inline PIN entry (numeric keypad, `secureTextEntry`) → `auth.pinLogin` → `setSession` → home. `FORBIDDEN` → show `error.message`. `UNAUTHORIZED` → `removeProfile(id)` + "Sign in with password." Long-press → confirm → `auth.logout({ refreshToken })` fire-and-forget + `removeProfile`. Button "Sign in with password" → `/login`. |
| `login.tsx` | Unchanged apart from the `Session` type. Success sets the session; the existing `<Redirect href="/" />` sends the user to `index.tsx`, which routes on `hasPin`. |
| `set-pin.tsx` (new) | Enter PIN twice, client-side match + `/^\d{6}$/`, → `auth.setPin({ pin })` → `store.setUser(result)` → `<Redirect href="/" />`. Not skippable: `index.tsx` redirects here while `user.hasPin === false`. |

## 3b. Desktop (`apps/desktop/src/renderer/src/app.tsx`)

Only change: a settings block on `Home`, rendered when `me.data?.permissions` includes
`settings.manage`. One number input "Auto-lock tablets after N minutes" (30 s – 60 min range,
stored as seconds) with a Save button → `settings.update`. `FORBIDDEN` is shown as a message even
though the block is hidden for non-owners — server enforces, UI only hides. Sign-in flow untouched.

## 4. Tests

Node 22 `node:test`, matching `refresh-window.test.ts`.

- `apps/api/src/auth/pin-policy.test.ts` — `rejectPinLogin` table (live/parked/rotated-in-grace
  pass; rotated-past-grace/logout/expired reject; expired-and-parked is `'expired'`).
- `apps/api/drizzle/seed/seed-rbac.test.ts` — already referenced by the `test` script but missing;
  created here: `holdersOf('settings.manage')` is `['owner']`, `holdersOf('sales.void_approve')`
  is `['owner', 'manager']`, `holdersOf('sales.create')` is `['owner', 'manager', 'cashier']`.
- Clients: no unit tests (none exist today). Manual checklist in the implementation plan: enrol,
  park, PIN login, wrong PIN, idle park, cold-start park, remove profile, owner changes
  timeout on desktop and tablet picks it up.

## 5. Known ceilings

- Idle timeout is detected and enforced on the tablet only. The server has no idle guard: a
  session whose client never parks (bug, killed app) stays usable until its refresh token expires.
  Deliberate — simpler to maintain, threat model is walk-up access. Upgrade path if needed:
  `last_used_at` on `refresh_tokens` checked in `auth.refresh` (cheap) or per request via a `sid`
  claim in the access JWT (kills access tokens on park too).
- `park` is fire-and-forget. If the call never reaches the server the token stays plain-refreshable
  (no PIN) until the next `pinLogin` rotates it. Exploiting it needs the token bytes off the device.
- No wrong-PIN lockout. Anyone at the tablet can keep guessing a parked profile's PIN; 6 digits =
  1 000 000 tries, argon2 verify ~50 ms each, so hours by hand, minutes by script with the token bytes.
  Deliberate for now. Upgrade path: `users.pin_failed_attempts`, lock at 5, revoke the user's
  refresh tokens, password login resets.
- Access JWTs are stateless: after a park an already-extracted access token works for up
  to `JWT_ACCESS_TTL` (15 min). Identical to `logout` today.
- Profile cards show the names of staff enrolled on that tablet. Acceptable on-site.
- One `settings` row for the whole deployment; per-store settings are out of scope.
