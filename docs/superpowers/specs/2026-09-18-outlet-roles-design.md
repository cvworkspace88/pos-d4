# Outlet Roles and Active Outlet — Design

**Date:** 2026-09-18
**Depends on:** `2026-09-16-outlets-design.md` (shipped in `a7f3718 feat: outlets`),
`2026-09-15-per-user-permission-overrides-design.md`.

## Goal

A user's role is decided per outlet: cashier at outlet 1, manager at outlet 2. The owner is the
exception and keeps a global role that works at every outlet without any membership row. To make
that possible the server must know which outlet a request is for, so a session gains an **active
outlet**: chosen once after login, auto-chosen when the user has exactly one, and carried by the
refresh token from then on.

## Non-goals

- **Per-outlet permission overrides.** `user_permissions` stays global. A cashier granted
  `sales.void_approve` holds it at every outlet they work at.
- **Mobile terminal registration.** Tablets will later be bound to an outlet and login there will
  force it. That is the next spec; this one gives mobile the same picker desktop gets so it keeps
  working meanwhile.
- **Outlet-scoping of domain data.** `tables` and `reservations` stay global. The `canActOn`
  helper introduced here is the hook they will use; they do not use it yet.
- **User administration.** No API sets `users.role_id`. Only the seed does, and only for the
  owner. Enforcing "only owner may be global" is therefore a policy, not code — a known ceiling.
- **A "role you may grant" rule on `setStaff`.** It rejects only `owner`. Any other role can be
  handed out by an `outlet.staff_assign` holder — today owner and manager, and manager already
  holds everything but `OWNER_ONLY`, so nothing escalates. It is one seed edit away from mattering;
  a known ceiling, same class as the global-role policy above.
- **Backoffice.** Still a scaffold with no auth. Untouched.
- **Filtering `outlet.list` by membership.** It keeps returning every live outlet to
  `outlet.view` holders. The picker reads the session's `outlets`, not this procedure.

## Data model

| Change | Detail |
| --- | --- |
| `outlet_staff.role_id` (add) | `uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT`. A membership row now says *what you are there*. |
| `users.role_id` (keep, re-meaning) | Nullable, now the **global role**: applies at every outlet, needs no `outlet_staff` row, bypasses outlet checks. The seed sets it to `owner` for the seeded owner. Null for everyone else. |
| `refresh_tokens.outlet_id` (add) | `uuid NULL REFERENCES outlets(id) ON DELETE SET NULL`. The session's active outlet lives on the row, so rotation, PIN unlock and parked profiles all keep it. Clients store nothing new. |
| `outlets`, `user_permissions`, `roles`, `permissions` | Untouched. |

**Migration.** One drizzle-generated migration, hand-extended with a backfill:

```sql
-- outlet_staff.role_id is added nullable, filled, then made NOT NULL
UPDATE outlet_staff s SET role_id = u.role_id FROM users u WHERE u.id = s.user_id AND u.role_id IS NOT NULL;
DELETE FROM outlet_staff WHERE role_id IS NULL;          -- a member with no role cannot exist
ALTER TABLE outlet_staff ALTER COLUMN role_id SET NOT NULL;
UPDATE users SET role_id = NULL
  WHERE role_id IS NOT NULL AND role_id <> (SELECT id FROM roles WHERE name = 'owner');
```

Pre-production; no rollback path is designed.

## Session

- The access JWT payload gains `outletId: string | null`. `issueSession(user, outletId)` writes the
  same value to the new `refresh_tokens` row.
- `sessionOutput` gains `outlet: { id, name } | null` and `outlets: { id, name }[]`. `outlets` is
  every live outlet when the user has a global role, otherwise the live outlets in their
  `outlet_staff` rows. `login`, `register`, `refresh` and `pinLogin` all return it; a freshly registered user has no role and no outlets, so gets `outlet: null`, `outlets: []`.
- **`auth.login`**: exactly one outlet → it is stamped automatically. Zero or many → `outlet: null`
  and the client decides (picker, or "no outlet assigned").
- **`auth.refresh`** gains an optional `outletId` input. Without it the row's outlet carries
  forward. With it the server checks the user may work there (member, or global role) and stamps
  the new session. **This is the picker and the switcher** — refresh already rotates and reissues,
  which is exactly what changing outlet is, so there is no `selectOutlet` procedure. The
  auto-refresh path in `createTokenProvider` never passes `outletId` and is otherwise untouched.
- **`auth.pinLogin`** carries the outlet from the parked row. A multi-outlet profile's first unlock
  returns `outlet: null`; mobile shows the picker and calls `refresh` with `outletId`.
- The same rule runs on every reissue: the carried or picked outlet sticks only while the user may
  still work there, and a lone outlet is chosen automatically. So a closed outlet or a lost
  membership falls back to the one outlet left, or to `outlet: null` when a choice remains.
- `ProtectedMiddleware` reads `outletId` from the payload and puts it on ctx beside `user`, with
  `global` derived from the user row it already loads:
  `{ user: PublicUser, outletId: string | null, global: boolean }` where `global = user.roleId !== null`.
  `PublicUser` and `userOutput` are unchanged; `global` is server-side only.
- `auth.me` returns `outletId` and the permissions for that outlet.

## Permissions

- `RbacService.permissionsOf(userId, outletId)`: the role source is `users.role_id` when set
  (global), otherwise `outlet_staff.role_id` where `outlet_id = outletId`. Overrides union in as
  today. A null outlet with no global role yields no role permissions — only per-user grants
  survive. Still one round trip.
- `RbacService.require(ctx, permission)` takes `{ user, outletId }` instead of a user id. Every
  existing `rbac.require(ctx.user.id, …)` call site updates. `effectivePermissions` is unchanged.

## Outlet-scoped calls

- New pure helper `canActOn(ctx, outletId)` in `rbac-rules.ts`: true when `ctx.global` or
  `outletId === ctx.outletId`.
- `outlet.staff` and `outlet.setStaff` apply it after their permission gate. A non-global user
  targeting another outlet gets `FORBIDDEN` `Wrong outlet.`.
- `outlet.setStaff` input becomes `{ outletId, staff: { userId, roleId }[] }`. Set semantics stay:
  the roster is replaced. A role named `owner` is rejected with `BAD_REQUEST` `Owner is global.`,
  so a manager cannot self-escalate. `outlet.staff` output gains `roleId`.
- `holdersOf`, `OWNER_ONLY` and the seed permissions are untouched. Owner remains the sole
  `outlet.manage` holder, so only the owner creates outlets or edits rosters outside their own.

## Clients

**Desktop.** The auth store keeps `outlet` and `outlets`. `App` branches three ways: no token →
`LoginForm`; token and `outlet` null → `OutletPicker`; otherwise `Home`. The picker only appears
when there is something to pick: with `outlets` empty the user lands on `Home` regardless — a
global role (the seeded owner on a fresh database) has full permissions with no outlet at all, and
a scoped user with no membership has none, which `Home` shows honestly instead of a dead end.
`OutletPicker` is a list of buttons, one per outlet; a click calls
`auth.refresh({ refreshToken, outletId })` through the
link-less refresh client and `setSession`s the result. Zero outlets shows "No outlet assigned.
Ask your owner." and a sign-out button. `Home` shows the outlet name and a "Switch" button that
sets a transient, unpersisted `switching` flag in the store; `App` treats it like a null outlet.
Clearing `outlet` itself would not work: the token provider's auto-refresh calls `setSession`, which
would put the old outlet back mid-pick. The token stays valid and no server call happens until the
next pick, which clears the flag.

**Mobile.** The same three-way branch in the root layout, with a picker screen at
`src/app/outlet.tsx`. `login` and `pin/[id]` land there when `outlet` is null and `outlets` is
non-empty. Parked profiles need no new fields; the server remembers the outlet on the refresh row.

## Error codes

All `FORBIDDEN` or `BAD_REQUEST` — none of them ends the session on either client.

| Situation | Code | Message |
| --- | --- | --- |
| `refresh` with an `outletId` the user may not work at | `FORBIDDEN` | `Not assigned to this outlet.` |
| Non-global user targets an outlet other than the active one | `FORBIDDEN` | `Wrong outlet.` |
| `setStaff` with the `owner` role | `BAD_REQUEST` | `Owner is global.` |
| Permission not held at the active outlet | `FORBIDDEN` | `Requires <permission>.` (existing) |

## Testing

- `rbac-rules.test.ts`: `canActOn` — global role, matching outlet, mismatch, null active outlet.
- `outlet-rules.test.ts`: owner rejection; staff diff now keyed on `(userId, roleId)`.
- `rbac.service.test.ts` (new, test database): `permissionsOf` with a global role, an outlet role,
  the wrong outlet, and a null outlet.
- `auth.service.test.ts` (new, test database): login auto-stamps a single outlet and leaves
  `null` for zero or many; refresh with `outletId` stamps, without it carries forward, with a
  foreign outlet is `FORBIDDEN`; pinLogin carries the parked row's outlet; a soft-deleted outlet
  comes back as `null`.
- `seed-rbac.test.ts` unchanged.
