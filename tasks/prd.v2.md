# PRD: F&B POS System (Indonesia)

Date: 2026-09-30. Status: draft v1. Written from the product brief only; existing repo code and specs were deliberately not consulted. Where the repo already satisfies a story, the implementer verifies it and marks the story done instead of rebuilding.

This is the current PRD for the product (v2). The earlier spec, kept for history as `tasks/prd.v1.md`, was reconciled into it; the owner's decisions are recorded in section 12. Stories US-088 and later were added during that reconciliation and sit in their phase, not in id order.

## 1. Introduction

A point-of-sale system for Indonesian food & beverage outlets (cafés, restaurants, bars, small chains). Three apps share one backend:

| App | Role | Connectivity |
| --- | --- | --- |
| **Desktop** (Electron, Windows first) | Outlet terminal. Hosts the outlet's local API ("hub") on a local Postgres (installed with Docker or manually). Cashier: orders, payments, shift, printing, KDS host, outlet admin screens. | Local-first. Sells and administers with no internet. A background sync service syncs with the cloud when it is running and online. |
| **Mobile** (Expo, tablet/phone) | Waiter: table map, order taking, send to kitchen, bill request, reservations. Kitchen tablets open the KDS screen. | Talks to the desktop hub over LAN. Never needs the internet. |
| **Backoffice** (web) | Owner/HQ: outlets, users, roles, menu, prices, promotions, inventory, reports across outlets. Never takes orders. | Always online, cloud only. |

The system sells in two editions: **Terminal** (desktop + mobile, fully local, no cloud account; each outlet is independent) and **Terminal + Cloud** (adds the background sync service, the backoffice and cross-outlet reporting). There is no licence enforcement: editions run on the honour system. Mobile always talks to the desktop over the LAN, never to the cloud. Every business rule that varies between outlets (tax, service charge, inclusive/exclusive pricing, rounding, business-day cutoff, tenders, receipt layout, void/discount policy, kitchen routing) is data, editable at runtime, never code.

Problem solved: Indonesian competitors (Moka, Majoo, Pawoon, Olsera, ESB, iSeller, Qasir, Kasir Pintar, Nutapos) all require a cloud backoffice, treat "offline" as a single-device queue, gate essentials (KDS, multi-device offline, ingredients) behind premium tiers, and none ship course hold/fire, in-POS waste, or per-item tax types. Owners complain of lost transactions, POS totals that disagree with the web at close, and forced buggy updates. This product wins on: LAN hub that keeps every device consistent without internet, all restaurant essentials in the base edition, exact money handling, and auditable corrections.

## 2. Goals

- Sell continuously with the internet down: order, send to kitchen, pay cash and manual non-cash, print, close shift, all against the desktop hub.
- Every tablet in the outlet sees the same live orders and table states within 1 second over LAN.
- Money is exact: integer rupiah, one deterministic pricing pipeline (line → discount → service charge → tax → rounding → total) covered by tests, configurable per outlet including inclusive/exclusive modes.
- Financial records are append-only and every correction (void, comp, refund, discount, price override, reopen) records who, approver, when, why.
- Zero duplicate orders or payments from retries or double taps (client-generated ids, idempotent writes).
- Desktop ↔ cloud sync loses nothing, never overwrites a bill, and shows its state on screen.
- Roles editable, permissions overridable per user, manager PIN override at the point of refusal.
- Terminal edition is fully operable from the desktop alone (menu, staff, settings, local reports) with no cloud at all.
- Ship in the phase order in section 4 so a sellable Terminal edition exists before backoffice-only features.

## 3. Competitive research summary

Sources: vendor help centers and pricing pages (Moka, Majoo, Pawoon, Olsera, ESB, iSeller, Qasir, Kasir Pintar, Nutapos, Toast, Square for Restaurants, Lightspeed K-Series, Loyverse, Odoo, Clover, Revel, SpotOn), Bapenda Jakarta, DDTC, Bank Indonesia, Kemnaker, Permendag 35/2013, UU 1/2022, UU 27/2022, PP 33/2026. Full notes were gathered on 2026-09-30.

**What Indonesian competitors ship (baseline we must match):** tables with move/split/merge, modifiers and combos, QRIS + EDC tenders, inclusive/exclusive tax toggle with tax base before/after discount (Moka; we fix the base after discount, US-025), scheduled promos and price lists (dine-in vs online: Kasir Pintar, ESB, Majoo), recipe/ingredient inventory with stock opname and transfers (Pro tiers), staff PIN and shift close with drawer reconciliation (iSeller), KDS on any device including Android TV (Majoo Prime), table turn-time colours with two warning thresholds (ESB, Majoo), customer order display with queue number (Majoo), reservation + queue display (ESB Book/Lounge, Olsera), loyalty points and vouchers, GoFood/GrabFood integrations, QR self-order.

**Gaps we exploit:** no local-only or hub topology (Majoo's LAN master/client is Rp999k/month), no course hold/fire anywhere, no in-POS waste log, no per-item tax type except Qasir Pro, tips not separated from service charge, sales-only reports without corrections/variance (Moka), data mismatch at close, employee-slot pricing.

**Behaviours copied from global leaders:** KDS ticket lifecycle with item and ticket bump, recall, two-threshold timers, all-day counts, voided-item marking, print-when-KDS-down (Toast, Lightspeed); split by item / equal parts / amount with proportional discount split (Square, Toast); comp vs void with mandatory reason and manager passcode (Square, Toast); drawer states, pay in/out, blind count, business-day cutoff (Toast, Lightspeed); item countdown with auto sold-out and daily reset (Toast, Square); LAN peers editing the same order offline (Lightspeed K); unsynced badge and "cannot sign out with unsynced data" (Loyverse); cash-only rounding shown as its own line (Square).

**Indonesian rules that shape the design (verified 2026-09-30):**
- Restaurant sales are subject to PBJT Makanan/Minuman (ex-PB1), max 10%, set per region; PPN does not apply to F&B. Non-food merchandise is PPN. So tax type is per item.
- Tax base is the amount paid after discount and includes service charge (Bapenda Jakarta worked example). Small outlets under a regional monthly turnover threshold are exempt: they set their PBJT rate to 0% (the rate is an outlet setting; the threshold is not stored).
- Service charge percentage is not fixed by law; typically 5–10%, usually dine-in only, shown as its own receipt line.
- Displayed prices must say whether they include tax and other fees (Permendag 35/2013). Rounding is allowed only for denominations not in circulation and must be disclosed at payment, so cash rounding is a visible line; non-cash pays exact.
- QRIS merchant fee may not be surcharged to customers. Every major e-wallet is a QRIS issuer, so one QRIS tender covers them.
- Jakarta requires electronic reporting of every transaction (E-TRAPT reads POS databases or CSV exports). Other regions use tapping boxes with vendor-specific formats. A per-transaction export is required; adapters are per region.
- Customer data (loyalty name/phone) falls under UU PDP 27/2022 and PP 33/2026: explicit consent, retention policy, deletion on request.
- Tax reporting period is the calendar month; daily business-date cutoff is a POS convention, so reports need both business date and calendar month.

## 4. Feature list and development order

Phases are ordered so that each phase yields something usable. Phases 0–5 make the Terminal edition sellable. Phase 6 adds the cloud sync service, phase 7 the backoffice. Later phases are add-ons.

| Phase | Feature area | Why here |
| --- | --- | --- |
| 0 | Platform: deployments (cloud/local), desktop hub on a local Postgres (Docker or manual install), first-run local setup, mobile hub discovery, outlet settings, auth, PIN profiles, outlets, roles/permissions/overrides, manager override, audit log, event log skeleton | Everything else depends on it |
| 1 | Menu & catalogue (one menu per outlet): categories, items, variants, modifier groups, combos, tax type, kitchen station, sold-out, menu schedules; desktop admin screens | Orders need a menu |
| 2 | Floor & tables: floors, tables, capacities, editor, statuses, timers, merge | Dine-in orders need tables |
| 3 | Orders: order lifecycle, pricing engine, order numbering, idempotency, send to kitchen, notes, seats, courses hold/fire, manual discounts, price override, void/comp with approval, transfer/merge/split, order types | The core of a POS |
| 4 | Kitchen: station printing, KDS web screen, ticket lifecycle, timers, recall, fallback printing | Orders must reach the kitchen |
| 5 | Payments & cash: tenders, split tender, cash rounding, change, receipts, refunds, reopen, shifts, drawer, Z report | Money in |
| 6 | Background sync service desktop ↔ cloud, device registration, second desktop as hub client, sync status UI, backup/restore | Cloud edition |
| 7 | Backoffice: outlets, users, roles, menu, settings, cross-outlet reports, exports (incl. per-transaction tax export) | Backoffice edition |
| 8 | Reservations & waitlist | Requested; independent of money |
| 9 | Reports on desktop (local) and backoffice (consolidated): sales, items, payments, tax, shift, corrections, hourly, staff | Owners need numbers |
| 10 | Inventory: ingredients, recipes, auto depletion, adjustments, opname, purchase orders, receiving, transfers, waste, low-stock, COGS | Bigger, separable |
| 11 | Promotions & customers: automatic discount rules, happy-hour price lists, vouchers, customer profiles with consent, loyalty points | Revenue growth features |
| 12 | Later: QR self-order + digital menu, delivery aggregators (GoFood, GrabFood), dynamic QRIS via gateway, regional tax adapters, tips, house accounts | Out of scope for this PRD, design must not block them |

## 5. User stories

Story ids are sequential across phases. Each story is one focused session. "Rules function" means a pure, decorator-free function in a `*-rules.ts` file with unit tests. "Setting" means a column added to `outlets` (or to the global `settings` row) as in US-004 of Phase 0.

### Phase 0 — Platform

### US-001: Deployment modes
**Description:** As an operator, I want one API codebase that runs as the cloud server or as the outlet hub so that both share business rules.

**Acceptance Criteria:**
- [ ] `DEPLOYMENT=cloud|local|all` read at boot; `all` only for contract generation and refuses to listen
- [ ] `cloud` mounts: auth, outlets, users/roles, catalogue mutations, settings mutations, sync receiver, backoffice reports. No printing, no hub endpoints
- [ ] `local` mounts: auth (against local users), POS routers (orders, payments, shifts, tables, kitchen), catalogue, user and settings mutations (the desktop is local-first, see US-052), printing, hub info. The sync client runs in the background sync service (US-049), not in the API
- [ ] Boot log prints the mode and the mounted router list
- [ ] Unit test: mounting table per mode
- [ ] Typecheck/lint passes

### US-002: Desktop hosts the local API on a local Postgres
**Description:** As a cashier, I want the desktop to run without any external server so that sales continue when the internet drops.

**Acceptance Criteria:**
- [ ] Postgres is not bundled: it runs on the outlet PC from Docker (a `docker compose` file shipped with the app) or a manual Windows install; setup docs cover both
- [ ] The desktop reads the database URL from its config; on first run, or when the database cannot be reached, a setup screen asks for host, port, database, user and password, tests the connection and saves it
- [ ] Electron main starts the API in `local` mode as a child process bound to `0.0.0.0` on a configurable port (default 3333), waits for health, then opens the renderer
- [ ] Drizzle migrations run on every start before the API accepts requests
- [ ] An API crash is restarted up to 3 times, then the renderer shows a blocking error with the log path; a lost database connection shows "Database tidak terhubung" with what to check (Docker running, service started)
- [ ] App quit stops the API cleanly
- [ ] Typecheck/lint passes

### US-088: First-run local setup (no cloud)
**Description:** As an owner on the Terminal edition, I want to set up my business on the desktop with no cloud account so that the outlet can sell on day one.

**Acceptance Criteria:**
- [ ] When the local database has no outlet, the desktop shows a setup wizard: first outlet (name, address, timezone, cutoff), owner username, password and PIN
- [ ] The wizard seeds roles, permissions and default settings locally; no activation key or licence check (honour system)
- [ ] Enabling cloud sync later is done in the sync service (US-053), never by re-running the wizard
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-003: Hub info and LAN pairing
**Description:** As a waiter, I want my tablet to find the desktop on the outlet Wi-Fi so that I never type an IP.

**Acceptance Criteria:**
- [ ] Hub advertises `_pos-hub._tcp` via mDNS with outlet name and port; desktop shows a "Hub" panel with LAN IP, port, outlet name and a QR code encoding `{host, port, outletId}`
- [ ] Mobile "Connect to hub" screen: lists discovered hubs, scans the QR, or accepts manual IP:port; stores the chosen hub per outlet
- [ ] Mobile pings `hub.info` every 10s when the app is in the foreground; shows a red "Hub offline" banner after 2 failures and grey "Reconnecting" until 1 success
- [ ] Renderer of the desktop talks to `127.0.0.1` on the same API
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-004: Outlet settings
**Description:** As an owner, I want every outlet-level rule editable at runtime so that nothing about tax, rounding or receipts is hard-coded.

**Acceptance Criteria:**
- [x] Outlet settings are typed columns on `outlets` (one row per outlet), each with its default and a DB `CHECK` on its range; a new setting is a new column, added by the story that first reads it
- [x] Saved through outlet mutations behind `outlet.manage` + `canActOn`: profile and timezone (`outlet.update`), taxes and service charge (`outlet.setCharges`: PBJT label/rate/inclusive, PPN rate/inclusive, NPWP, NPWPD, service name/rate/taxable/order types), business day (`outlet.setBusinessDay`: cutoff, auto close)
- [x] Global settings live in the single `settings` row: `idle_timeout_seconds` (mobile PIN idle lock, default 120) and `desktop_lock_seconds` (default 0 = off), read by any signed-in user via `settings.get`, saved by `settings.update` (a patch) behind `settings.manage`
- [x] Rates are integer basis points (1000 = 10%); times are local `HH:mm` in the outlet's timezone
- [x] Backoffice edits them: outlet settings page (profile, tax & service, business day tabs) and app settings page (lock timers)
- [x] Typecheck/lint passes

Audit rows on settings writes come with US-011.

### US-005: Username/password login and sessions
**Description:** As any staff member, I want to log in with username and password and stay logged in safely.

**Acceptance Criteria:**
- [x] `auth.login(username, password)` → access JWT (15 min) + opaque refresh token (SHA-256 hash stored, rotated on use, 30 s grace for the previous token to absorb concurrent refreshes)
- [x] Passwords hashed with argon2id; 5 failed logins within 15 min lock the user for 15 min (`FORBIDDEN` + `data.reason: 'LOCKED'`, message says how long; clients show the "Terlalu banyak percobaan gagal" dialog); every password check (login, change password, change PIN) counts toward and obeys the lock; a staff manager can clear it early with a password reset (US-057)
- [x] Change password (self, all apps): current password + new password; counts toward and obeys the password lock. A forgotten password cannot be reset by its owner: a staff manager resets it (US-057)
- [x] JWT carries `sub` (user id), `username`, `outletId`, `exp`. No `roleId`: roles are per outlet and `rbac.require` reads them from the DB, so a role change applies without a new token. `deviceId` is added by US-003
- [x] Any `UNAUTHORIZED` response ends the client session (store cleared, cache dropped, back to login); `FORBIDDEN` never does
- [x] `auth.logout` revokes the refresh token with reason `logout`
- [x] Tests: rotation, grace window, lockout, revoked token refused
- [x] Typecheck/lint passes

### US-006: Mobile PIN profiles for shift changes
**Description:** As a waiter on a shared tablet, I want to switch to my profile with a 6-digit PIN so that shift changes take seconds, but only after I logged in once with my password.

**Acceptance Criteria:**
- [x] First login on a device with username/password creates a profile on that device (name, avatar initials; the outlet rides on its parked token) and asks the user to set a PIN if none exists
- [x] "Sign out" parks the session (refresh token kept with reason `parked`); profile stays on the device
- [x] Profile picker screen lists parked profiles; tapping one asks for the PIN; `auth.pinLogin(refreshToken, pin)` (the profile's parked token) redeems it and issues a new session
- [x] Wrong PIN returns `UNAUTHORIZED` with `data.reason: 'INVALID_PIN'`; client shows "PIN salah" and does not end the session; 5 wrong PINs in 10 min lock PIN login for 10 min (`FORBIDDEN` + `data.reason: 'LOCKED'`, same dialog as the password lock) — per user, not per profile; separate from the approval block (US-010)
- [x] Change PIN (self; mobile, and the desktop account menu): changing needs the password. Creating a first PIN happens on the forced "Buat PIN" screen right after a password login (mobile and desktop) and needs no password only within 5 min of that login (a PIN is also an approval credential); after that, or when a PIN already exists, the server answers `NEEDS_PASSWORD` and the screen asks for it (counts toward and obeys the password lock); a successful change clears the PIN lock. A forgotten PIN cannot be reset by its owner: a staff manager resets it (US-057)
- [x] Parked tokens cannot be used by `auth.refresh`; only `pinLogin` redeems them
- [x] Idle lock after `idle_timeout_seconds` (setting, default 120) parks the session and returns to the profile picker
- [x] "Remove profile" asks for confirmation only ("Hapus {nama}?"; no PIN or manager needed: the user just signs in with their password again), forgets the profile on the device and revokes its parked token
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [x] Typecheck/lint passes

### US-007: Desktop login
**Description:** As a cashier, I want to log in on the desktop with username and password, and lock the screen between users.

**Acceptance Criteria:**
- [x] Desktop login screen with username/password; no PIN profile picker. A user without a PIN must create one right after logging in (same screen rule as mobile)
- [x] "Lock" button and `security.desktop_lock_seconds` (setting, default 0 = off) show a lock screen for the same user only: a user with a PIN has the session parked (as mobile's sign-out) and reopens it with the PIN (`auth.pinLogin`, the PIN lock); the lock screen shows a keypad (and takes keyboard digits). A user without a PIN (only possible if one was cleared) keeps the session and reopens it with the password (`auth.unlock`, the password lock). The PIN and password are changed from the account menu
- [x] Current user and role shown in the top bar; "Switch user" logs out and returns to login
- [x] Verify in browser using dev-browser skill (renderer, headless Chromium, 2026-10-02)
- [x] Typecheck/lint passes

### US-008: Outlets and staff membership
**Description:** As an owner, I want several outlets, each with its own staff and role assignments.

**Acceptance Criteria:**
- [x] Tables `outlets(id, name, code, address, phone, npwp, timezone, deleted_at)` (closing an outlet is `outlet.setActive(false)`, a soft delete; name and code unique among live outlets), `outlet_staff(outlet_id, user_id, role_id)` (a membership is a row; removing it deletes the row)
- [x] `users.role_id` holds the global role (owner) that needs no membership; everyone else acts only in outlets where they have a membership, at a live outlet
- [ ] Login on a device bound to outlet X refuses users without membership there: `FORBIDDEN` "Anda tidak terdaftar di outlet ini." (needs device binding, lands with US-003)
- [x] `auth.refresh({outletId})` switches active outlet for multi-outlet users (backoffice and owners)
- [x] `canActOn(ctx, outletId)` guard used by every query and mutation that takes an outlet id; refusal is `FORBIDDEN` "Outlet tidak ditemukan."
- [x] Tests: membership check, global role bypass, guard
- [x] Typecheck/lint passes

### US-009: Roles, permissions catalogue and per-user overrides
**Description:** As an owner, I want fixed base roles, my own custom roles, and the ability to grant or revoke single permissions for one person at one outlet.

**Acceptance Criteria:**
- [x] Tables `roles(id, name, description, is_global, editable)`, `permissions(name, description)`, `role_permissions`, `user_permissions(user_id, outlet_id, permission, effect grant|revoke)` with `outlet_id` required — an override always belongs to one outlet; there are no global overrides
- [x] Seed the permission catalogue and base roles Owner, Manager, Supervisor, Cashier, Waiter, Kitchen, Accountant with the grants in Appendix B; one permission per action, no request/approve pairs (approval is US-010)
- [x] Rules function `effectivePermissions(roleGrants, overrides)` = role grants + grants − revokes; revoke wins over grant; tests
- [x] `rbac.require(ctx, 'domain.action')` reads the role for `ctx.outletId` and applies the overrides for that outlet only; refusal is `FORBIDDEN` "Anda tidak memiliki akses." never `UNAUTHORIZED`
- [x] Base roles are locked (`editable = false`, owned by the seed); custom roles are created (typically by duplicating a base role), edited and deleted through `role.create/update/delete` behind `role.manage`; a role still assigned cannot be deleted
- [x] Overrides are set per user and outlet (several outlets in one call) through `role.setOverride` behind `permission.override`; `role.userPermissions` shows each permission's source (role / grant / revoke)
- [x] Owner is the only global role: cannot be edited or deleted, cannot be assigned per outlet (`BAD_REQUEST` "Owner is global."), takes no overrides
- [x] Role edits and overrides write audit rows (module `role`)
- [x] Typecheck/lint passes

### US-010: Manager PIN override at the point of refusal
**Description:** As a cashier lacking a permission, I want a manager to approve a single action by entering their PIN on my screen so that the manager's session is never exposed.

**Acceptance Criteria:**
- [x] Any guarded mutation accepts optional `approval: {approverUserId, pin}`; server verifies the approver has the permission and `approval.grant`, checks the PIN, then executes as the caller while recording `approved_by`
- [x] Wrong approver PIN → `UNAUTHORIZED` + `data.reason: 'INVALID_PIN'`; approver without permission → `FORBIDDEN`
- [x] Client: on `FORBIDDEN` from an overridable action, shows an "Minta akses" dialog (approver picker of users with `approval.grant` at this outlet + PIN pad + reason if the action needs one) and retries the same mutation with the same idempotency id
- [x] Every overridden action appears in the audit log with actor, approver, action, reason, entity
- [x] Brute force blocks the **requester**, never the approver: 5 wrong approval PINs within 10 min block that user from requesting any override (every action — a block earned on a refund also refuses a void) at every outlet for 10 min; refused with `FORBIDDEN` before the PIN is checked. Each wrong approval PIN tells the requester how many tries are left ("PIN salah. Sisa N percobaan."). Other staff keep using the same manager's PIN; the blocked user keeps all features their own permissions allow; wrong approval PINs never lock the manager's own PIN (revised 2026-10-02)
- [x] The block writes an audit row (`approval.blocked`: requester, permission, approver tried, blocked until); it lifts by itself after 10 min (no row)
- [x] Staff page shows a blocked user ("Diblokir hingga HH:mm") and a "Buka blokir" button; `approval.unblock` (new permission, Manager by default) clears it early and writes `approval.unblocked` (who unblocked whom)
- [ ] Verify in browser using dev-browser skill
- [x] Typecheck/lint passes

Wired so far: table.merge/unmerge, reservation.create/update (2026-10-02); void, comp, refund, discount, price override, reopen and shift variance opt in with requireOrApprove when they land. Reason is never required yet.

### US-011: Audit log
**Description:** As an owner, I want every sensitive action recorded so that disputes can be settled.

**Acceptance Criteria:**
- [x] Table `audit_log(id uuid, outlet_id nullable, actor_user_id, approver_user_id nullable, module, action, entity_type, entity_id, reason, before jsonb, after jsonb, device_id, created_at)`; one table for every module (`module` column, `action` = `module.verb`); `before`/`after` hold only the changed fields, secrets masked; insert-only, enforced by a DB trigger, no update/delete routers
- [x] Helper `audit(tx, actor, {...})`, written in the same transaction as the change, used by settings, outlet, staff and menu (categories, items, add-ons) now; roles (US-009), void/comp/refund/discount/price override/reopen, shift close and sync device actions call it when those stories land
- [x] `audit.list(outletId, {fromDate, toDate, module?, userId?, cursor?})` keyset-paginated, dates in the outlet's timezone, permission `report.view_audit`; backoffice "Log Audit" page
- [x] Typecheck/lint passes

### US-012: Event log and client ids (write model)
**Description:** As a developer, I need every transactional write to be an idempotent, ordered event so that sync and retries are safe by construction.

**Acceptance Criteria:**
- [x] All transactional entities (orders, lines, payments, refunds, shifts, drawer entries, kitchen tickets, table sessions, reservations, stock ledger) use client-generated UUID v7 primary keys (reservations so far, via `createOnce` and `uuidv7()` from `@repo/api-contract`; each later entity lands the same way)
- [x] Table `sync_events(id uuid, outlet_id, device_id, seq bigserial, type, entity_id, payload jsonb, actor_user_id, created_at, synced_at nullable)`; every transactional mutation writes its entity change and an event in one DB transaction
- [x] Repeating a mutation with an already-stored id is a no-op that returns the stored result (idempotency), verified by a test that calls the same mutation twice
- [x] `sync.pendingCount` returns the unsynced count for the active outlet
- [x] Typecheck/lint passes

### Phase 1 — Menu & catalogue

### US-013: Categories and items
**Description:** As a menu manager, I want my outlet's menu of categories and items with images and descriptions. Each outlet has its own menu: two outlets may sell entirely different food under different brands.

**Acceptance Criteria:**
- [x] Tables `categories(id, outlet_id, name, sort, color, kitchen_station_id nullable, active, deleted_at)`, `items(id, outlet_id, category_id, name, kitchen_name, sku, description, image_url, base_price int, tax_type pbjt|ppn|none, kitchen_station_id nullable, sold_by unit|weight, sort, active, deleted_at)`; add-on groups are per outlet too
- [x] Every read and write is scoped to the session's active outlet (no procedure takes an outlet id from input); an item's category, station and add-on groups must belong to the same outlet, else `NOT_FOUND`
- [x] Item kitchen station defaults to its category's station
- [x] Soft delete only (`deleted_at`)
- [x] Name unique among live items of the same outlet (`CONFLICT` "Nama menu sudah dipakai."; categories "Nama kategori sudah dipakai.")
- [x] `menu.list` returns the active outlet's full menu in one call (categories → items → variants → modifier groups)
- [x] Guarded by `menu.view` / `menu.manage` (and `category.view` / `category.edit`); by default the outlet Manager role holds them, and per-user overrides (US-009) let the client move them to any user
- [x] Typecheck/lint passes

### US-014: Variants
**Description:** As an owner, I want size or type variants of one item, each with its own price and SKU.

**Acceptance Criteria:**
- [ ] Table `item_variants(id, item_id, name, price int, sku, sort, active)`; an item with variants requires a variant choice at order time; an item without variants is sold at `base_price`
- [ ] Item list shows "mulai Rp X" = lowest active available variant price
- [ ] Typecheck/lint passes

### US-015: Modifier groups
**Description:** As an owner, I want modifier groups (e.g. sugar level, extra shot) with required/optional and min/max rules and per-option price.

**Acceptance Criteria:**
- [ ] Tables `modifier_groups(id, name, min_select, max_select, required, allow_duplicate, sort)`, `modifier_options(id, group_id, name, price int, kitchen_name, sort, active)`, `item_modifier_groups(item_id, group_id, sort)`
- [ ] Rules function `validateSelection(group, selected[])` returns a localized error: below min "Pilih minimal N", above max "Maksimal N", required not chosen "Wajib dipilih"; tests
- [ ] One group can attach to many items
- [ ] Typecheck/lint passes

### US-016: Combos
**Description:** As an owner, I want combo items (paket) built from choice groups at a bundle price.

**Acceptance Criteria:**
- [ ] `items.kind = single|combo`; `combo_groups(id, combo_item_id, name, min, max, sort)`, `combo_group_items(group_id, item_id, variant_id nullable, extra_price int)`
- [ ] Ordering a combo expands to component lines flagged `parent_line_id`, priced at the combo price plus extras; components route to their own kitchen stations
- [ ] Voiding a combo voids all its components together
- [ ] Rules function `expandCombo` with tests
- [ ] Typecheck/lint passes

### US-017: Per-outlet price and availability — dropped
**Superseded (2026-10-01):** each outlet has its own menu (US-013), so an outlet's price and on/off are the item's own `base_price` and `active`. No `outlet_item_overrides` table. Bulk price edit moves to US-058.

### US-018: Sold-out (86) and countdown
**Description:** As a cashier, I want to mark an item sold out or set "only 12 left" so that waiters stop selling it.

**Acceptance Criteria:**
- [ ] Table `item_availability(outlet_id, item_id, variant_id nullable, status available|sold_out|counted, remaining int nullable, reset_daily bool, reset_to int nullable, updated_by, updated_at)`; owned by the outlet hub (works offline)
- [ ] Selling a `counted` item decrements `remaining` on send; reaching 0 flips to `sold_out`; at business-day rollover items with `reset_daily` reset to `reset_to`
- [ ] Sending a sold-out item is refused with `PRECONDITION_FAILED` "Habis." and the client refreshes the menu
- [ ] POS shows a "Habis" badge and remaining count; a quick-toggle on the desktop and mobile item card guarded by `menu.sold_out`
- [ ] Availability changes broadcast to all LAN clients within 1 s
- [ ] `menu.list` applies availability: each item (and variant) carries its status and remaining count, so the POS shows sold-out from the one-call menu (completes US-013)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-019: Menu schedules
**Description:** As an owner, I want categories or items only available at certain times (breakfast menu, happy hour set).

**Acceptance Criteria:**
- [ ] Table `menu_schedules(id, outlet_id nullable, target_type category|item, target_id, days int[] 0-6, start_time, end_time)`
- [ ] Rules function `isScheduledNow(schedules, now, timezone)` handles ranges across midnight; tests
- [ ] POS hides off-schedule items; admin sees them with a clock badge
- [ ] Typecheck/lint passes

### US-020: Desktop menu admin screens
**Description:** As an owner on the Terminal edition, I want to manage the menu from the desktop.

**Acceptance Criteria:**
- [ ] Desktop "Menu" section: categories list, item list with search and filters, item editor (variants, modifier groups, combo groups, tax type, station, image), availability toggles; all scoped to the active outlet's menu
- [ ] Writes go to the local hub and work with no internet; each write is recorded as a master-data event that the sync service pushes to the cloud when it runs (US-052)
- [ ] LAN clients see the change within 1 s (`menu.changed` broadcast)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 2 — Floor & tables

### US-021: Floors and tables
**Description:** As a manager, I want floors (Lantai 1, Teras) with named tables and capacities.

**Acceptance Criteria:**
- [ ] Tables `floors(id, outlet_id, name, sort, active, deleted_at)`, `tables(id, outlet_id, floor_id, name, capacity, shape rect|round, x, y, w, h, rotation, active, deleted_at)`
- [ ] Table name unique per outlet among live tables (`CONFLICT` "Nama meja sudah dipakai.")
- [ ] Soft delete; a table with an open order cannot be deleted (`PRECONDITION_FAILED` "Meja masih terpakai.")
- [ ] `floor.list(outletId)` returns floors, tables and each table's live status in one call
- [ ] Typecheck/lint passes

### US-022: Floor plan editor
**Description:** As a manager, I want to drag tables into position so that the map matches the room.

**Acceptance Criteria:**
- [ ] Desktop editor: add/rename/resize/rotate/move tables on a grid, choose shape, set capacity, per floor; save writes positions in one mutation
- [ ] Geometry rules (overlap check, bounds) in a rules function with tests
- [ ] Permissions `table.create`, `table.delete`, `table.layout_manage`
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-023: Table status and timers
**Description:** As a waiter, I want to see which tables are free, seated, have a bill printed, or need attention.

**Acceptance Criteria:**
- [ ] Table status derived from live data: `free`, `seated` (open order or pax set), `billed` (bill printed, unpaid), `reserved` (reservation within the hold window), `merged`
- [ ] Table card shows elapsed time since seating; colour thresholds from settings `tables.warn_minutes_1` and `tables.warn_minutes_2`
- [ ] Status updates push to all LAN clients within 1 s
- [ ] Map available on desktop and mobile with the same colours
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-024: Merge and unmerge tables
**Description:** As a waiter, I want to join two tables for a large party and split them back later.

**Acceptance Criteria:**
- [ ] `table.merge(primaryId, secondaryIds[])`: secondaries must be free; merged group shares one order; secondaries show "→ primary"
- [ ] `table.unmerge(primaryId)` allowed only when no open order (`PRECONDITION_FAILED` "Selesaikan pesanan dulu.")
- [ ] Deleting or reserving a merged table is refused with "Unmerge first."
- [ ] Typecheck/lint passes

### Phase 3 — Orders

### US-095: Order types per outlet
**Description:** As an owner, I want my own list of order types — Dine In, Take Away, Delivery, and the delivery platforms I sell on (GoFood, GrabFood, ShopeeFood) — so that each one carries its own service charge, prices, payment and reports. Platform orders are typed in by the cashier; the automatic aggregator link stays Phase 12.

**Acceptance Criteria:**
- [ ] Table `order_types(id, outlet_id, name, kind dine_in|takeaway|delivery, prefix, service_charge bool, active, sort)`; name unique per outlet (`CONFLICT` "Nama tipe pesanan sudah dipakai.")
- [ ] `kind` drives behaviour, the name is only a label: `dine_in` uses tables and pax (`orders.require_table_for_dine_in`); `takeaway` and `delivery` have no table. GoFood, GrabFood and ShopeeFood are `delivery` rows
- [ ] Every outlet is seeded with Dine In (`dine_in`, prefix "", service charge on), Take Away (`takeaway`, "T", off) and Delivery (`delivery`, "D", off); a new outlet gets the same three
- [ ] `service_charge` on the row replaces `outlets.service_order_types` (migration copies the column into the seeded rows, then drops it)
- [ ] Never deleted once used: an order type with orders can only be deactivated (`active = false`); a deactivated type is hidden from the order screen and kept in reports
- [ ] The first active type by `sort` is the default on the order screen
- [ ] `orders.external_ref` (nullable): the platform booking code, entered on `delivery` orders, shown on the receipt and searchable (US-089)
- [ ] `orderType.list` (active outlet, any signed-in user) and `orderType.create/update/reorder/setActive` behind `settings.manage`, scoped to the active outlet; backoffice and desktop admin screens
- [ ] Price lists (US-083) and promotions (US-082) target order type ids; tenders (US-040) may be named as an order type's default tender; reports group by order type (US-067 sales summary, US-061 per-transaction export)
- [ ] Typecheck/lint passes

### US-025: Pricing engine
**Description:** As a developer, I need one pure function that turns order lines and outlet settings into every money figure so that receipts, reports and tax always agree.

**Acceptance Criteria:**
- [ ] Rules function `priceOrder(lines, discounts, settings) → {lines[], subtotal, discountTotal, serviceCharge, taxByType, rounding, total}` in integer rupiah, half-up rounding at each step
- [ ] Pipeline order: line total (qty × unit + modifiers) → line discounts → bill discount allocated proportionally to remaining line totals → subtotal → service charge on the whole discounted subtotal, only when the order's type has `service_charge` on (US-095; default only Dine In); there is no per-item service-charge flag → tax per `tax_type` on (subtotal after discount) plus service charge when `service_charge.taxable`; tax is always charged after discounts → cash rounding (US-041) → total
- [ ] Settings honoured: `tax.rates` per type, `tax.pbjt_inclusive`, `tax.ppn_inclusive`, `service_charge.rate`, the order type's `service_charge` flag, `service_charge.taxable` (service charge is always exclusive)
- [ ] Inclusive mode backs the item's tax out of its gross price so that gross stays what the menu shows: net = gross ÷ (1 + tax); the service charge is always added on top, and taxed on top when `service_charge.taxable`
- [ ] A tax type at 0% adds no tax (how an exempt outlet is set up)
- [ ] Worked examples fixed by tests: (a) exclusive: 2 × 50.000, 10% bill discount, SC 5%, PBJT 10% → subtotal 90.000, SC 4.500, tax 9.450, total 103.950; (b) inclusive tax only: 50.000 → net 45.455, tax 4.545; (c) mixed cart with one `ppn` item and one `none` item taxed separately; (d) PBJT at 0% → no tax
- [ ] Typecheck/lint passes

### US-026: Order creation and lines
**Description:** As a waiter or cashier, I want to open an order of any of the outlet's order types (US-095) and add items with variants, modifiers, quantity and notes.

**Acceptance Criteria:**
- [ ] Tables `orders(id, outlet_id, business_date, order_no, order_type_id, external_ref nullable, status open|paid|void, table_id nullable, pax, customer_id nullable, opened_by, opened_at, closed_at, notes, version, totals…)`, `order_lines(id, order_id, seq, item_id, variant_id, name_snapshot, variant_snapshot, modifiers_snapshot jsonb, unit_price_snapshot, tax_type_snapshot, tax_rate_snapshot, kitchen_station_snapshot, qty, notes, seat, course, status pending|sent|voided|comped, parent_line_id, sent_at, created_by)`
- [ ] `order.create({id, outletId, orderTypeId, tableId?, pax?, externalRef?})`: an order type of kind `dine_in` requires a table when `orders.require_table_for_dine_in`; a table with an open order returns that order instead of creating a second (idempotent by table)
- [ ] `order.addLines({orderId, lines[], expectedVersion})` snapshots name, price, modifiers, tax type/rate, station at that moment; validates modifier selection; totals recomputed with US-025 and stored
- [ ] Every order mutation checks `expectedVersion` and returns `CONFLICT` "Pesanan berubah, muat ulang." on mismatch; clients refetch and reapply
- [ ] Pending (unsent) lines may be edited or removed freely by the creator or anyone with `order.edit_others`
- [ ] `order_lines.item_id` references `menu_items` with `ON DELETE RESTRICT`, so an item with order lines can never be hard-deleted (completes US-013)
- [ ] Typecheck/lint passes

### US-027: Order numbering per business date
**Description:** As a cashier, I want short sequential order numbers that restart every business day so that kitchen and customers can call them.

**Acceptance Criteria:**
- [ ] Rules function `businessDate(timestamp, timezone, cutoffTime)`: times before the cutoff belong to the previous date; tests including midnight and DST-free Asia/Jakarta
- [ ] Hub assigns `order_no` from a per-outlet, per-business-date counter inside the same transaction as `order.create`, formatted by `orders.number_format` (e.g. `{type_prefix}{seq:03}` → `D-007`, the prefix taken from the order type, US-095)
- [ ] Numbers are gapless; a voided order keeps its number
- [ ] Bill number for receipts (`bill_no`) is assigned at first payment from a separate gapless per-outlet counter that never resets (for tax recaps)
- [ ] Typecheck/lint passes

### US-028: Send to kitchen, courses and hold/fire
**Description:** As a waiter, I want to send pending lines to the kitchen, optionally per course, and hold a course until the guest is ready.

**Acceptance Criteria:**
- [ ] `order.send({orderId, lineIds?, expectedVersion})` marks lines `sent`, creates kitchen tickets per station (Phase 4), decrements countdown availability
- [ ] Lines carry `course` (1..n) and `hold` flag; `order.fire({orderId, course})` releases a held course to the kitchen; unsent held lines are visible to the kitchen only after fire
- [ ] A sent line's course cannot change; changing quantity of a sent line is refused (`PRECONDITION_FAILED` "Sudah dikirim ke dapur, void saja.")
- [ ] Mobile and desktop show per-line state badges: pending, held, sent, ready, served
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-029: Seats and guest notes
**Description:** As a waiter, I want to tag lines with a seat number so that food is served to the right guest and bills can split by seat.

**Acceptance Criteria:**
- [ ] `seat` optional integer per line, default null (shared); seat picker in the order screen; kitchen ticket prints seat
- [ ] Order-level note and per-line note (max 200 chars) printed on kitchen tickets
- [ ] Typecheck/lint passes

### US-030: Manual discounts
**Description:** As a cashier, I want to give a percentage or fixed discount on a line or the whole bill with a reason.

**Acceptance Criteria:**
- [ ] Table `order_discounts(id, order_id, line_id nullable, kind percent|amount, value, reason_id, note, applied_by, approved_by, created_at, voided_at)`; discounts are rows, never edits of a price
- [ ] Reasons from setting `discounts.reasons` (list); reason required
- [ ] Permission `order.discount_line` / `order.discount_bill`; role setting `discounts.max_percent_by_role` caps percent, above cap triggers the manager override flow (US-010)
- [ ] Removing a discount sets `voided_at`, does not delete
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-031: Price override and open-price items
**Description:** As a manager, I want to override a line price or sell an open-price item (e.g. "Lainnya") with a typed price.

**Acceptance Criteria:**
- [ ] `order.overridePrice({lineId, price, reason})` guarded by `order.price_override`, keeps the original price in `unit_price_snapshot` and stores `override_price` + reason + approver
- [ ] Items flagged `open_price` prompt for a price on add; min 0, max `orders.max_line_amount`
- [ ] Typecheck/lint passes

### US-032: Void and comp sent lines
**Description:** As a cashier, I want to void a sent line (not made) or comp it (made, given free) with a reason and manager approval when required, so that waste and giveaways are tracked.

**Acceptance Criteria:**
- [ ] `order.voidLines({lineIds, reason, note})` requires `order.void_sent`; `order.compLines` requires `order.comp`; both accept `approval` (US-010)
- [ ] Voided lines: excluded from all totals and from sales reports, counted in the corrections report; comped lines: kept in item sales counts and inventory depletion, contribute 0 to revenue, shown as "Comp" on the receipt
- [ ] Kitchen receives a VOID ticket update (Phase 4)
- [ ] Reasons from settings `voids.reasons`; note required when reason is "Lainnya"
- [ ] Voiding the last live line on a dine-in order leaves the order open and the table seated until the order is cancelled (US-033)
- [ ] Typecheck/lint passes

### US-033: Cancel an unpaid order
**Description:** As a cashier, I want to cancel an order that will not be paid so that the table frees up and the number is accounted for.

**Acceptance Criteria:**
- [ ] `order.cancel({orderId, reason})` allowed only when no captured payments; sent lines are voided in the same transaction with the same reason; status `void`; table freed
- [ ] Permission `order.cancel`; appears in the corrections report
- [ ] Typecheck/lint passes

### US-034: Transfer, merge and split orders
**Description:** As a waiter, I want to move an order to another table, move lines between orders, merge two orders, and split a bill by items, by seat, equally, or by amount.

**Acceptance Criteria:**
- [ ] `order.transferTable`, `order.moveLines(fromOrderId, toOrderId, lineIds)`, `order.merge(intoOrderId, fromOrderId)` guarded by `order.transfer`/`order.merge`; all keep line snapshots and sent status
- [ ] `order.transferWaiter({orderId, toUserId, expectedVersion})` hands the order to another waiter at the same outlet, guarded by `order.transfer`, audited with from/to user
- [ ] `order.split({orderId, mode: items|seats|equal|amount, spec})` creates child orders with new order numbers, moving lines (items/seats) or creating proportional shares (equal/amount); percent discounts copied, fixed discounts allocated proportionally; rules function with tests proving the children sum to the parent total to the rupiah
- [ ] Split is refused when the order has a captured payment on the lines being moved (`PRECONDITION_FAILED`)
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-035: Order screens on mobile and desktop
**Description:** As a waiter or cashier, I want a fast touch-first order screen.

**Acceptance Criteria:**
- [ ] Layout: category tabs, item grid with images and price, cart panel with quantity steppers, modifiers sheet, notes, seat/course chips, Send and Bill buttons; hit targets ≥ 48 dp
- [ ] Adding an item with no variants/modifiers is one tap; item search by name
- [ ] Cart totals use the same pricing function (shared package) so the preview matches the server to the rupiah
- [ ] No blocking spinners on add/send: optimistic UI with reconciliation on `CONFLICT`
- [ ] Every error toast says what to do next ("Pesanan berubah, memuat ulang…", "Habis, pilih menu lain")
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-089: Order search
**Description:** As a cashier or waiter, I want to find any order quickly so that I can reprint, pay or correct it.

**Acceptance Criteria:**
- [ ] `order.search(outletId, {query?, status?, tableId?, waiterId?, customerPhone?, from?, to?})` matches order no, bill no, table name, waiter and customer phone; defaults to the current business date; paginated
- [ ] Search box on the desktop cashier screen and on mobile; tapping a result opens the order
- [ ] Rules or query test for business-date filtering and matching by bill no
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-090: Park and recall takeaway orders
**Description:** As a cashier, I want to park a takeaway order and recall it later with a queue number so that the queue keeps moving while a customer decides.

**Acceptance Criteria:**
- [ ] Takeaway orders get a queue number per business date (from the order number counter's type prefix, e.g. `T-012`) printed on the receipt and kitchen ticket
- [ ] "Simpan" parks the open takeaway order and clears the screen; a "Pesanan tersimpan" list shows parked orders with queue number, age and total; tapping recalls it
- [ ] Parked orders are ordinary open orders (no separate table); two devices recalling the same order resolve via `expectedVersion`
- [ ] Self-pickup is served by the takeaway type; there is no separate pickup type
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 4 — Kitchen

### US-036: Kitchen stations and routing
**Description:** As a manager, I want stations (Bar, Hot Kitchen, Dessert) with a printer and/or KDS each so that tickets go where the food is made.

**Acceptance Criteria:**
- [ ] Table `kitchen_stations(id, outlet_id, name, mode print|kds|both, printer_id nullable, print_when_kds_offline bool, sort, active)`, per outlet like the menu (US-013); a category or item may point only at a station of its own outlet
- [ ] Sending an order creates one `kitchen_tickets(id, order_id, station_id, course, status new|in_progress|done|recalled, created_at, bumped_at, bumped_by)` per station per send, with `kitchen_ticket_lines(ticket_id, line_id, qty, status)`
- [ ] Lines with no station go to the setting `kitchen.default_station_id`
- [ ] Typecheck/lint passes

### US-037: Kitchen ticket printing (ESC/POS)
**Description:** As a cook, I want a printed ticket per station with order number, table, time, items, modifiers, notes, seat and course.

**Acceptance Criteria:**
- [ ] Electron main owns a print queue: jobs persisted in `print_jobs(id, printer_id, kind, payload, status queued|printed|failed, attempts, last_error)`; retry with backoff; failed jobs shown in a desktop "Printer" panel with Reprint
- [ ] Printers configured per outlet: name, connection `network` (LAN/Wi-Fi, host:port 9100), `usb`, `bluetooth` (paired Windows COM port) or `serial`, paper width 58/80 mm, code page; the same printer list serves receipt and kitchen roles; test print button per printer
- [ ] Ticket layout from a rules function that renders a plain-text model (tested); options `kitchen.consolidate_identical_lines`, `kitchen.one_ticket_per_item`, `kitchen.use_kitchen_names`
- [ ] VOID tickets print strike-through "(VOID)" lines on the affected station
- [ ] Typecheck/lint passes

### US-038: KDS web screen
**Description:** As a cook, I want a tablet screen of live tickets that I can bump per item or per ticket, with timers.

**Acceptance Criteria:**
- [ ] Hub serves `/kds?station=<id>` as a web page (React) on the LAN; opens in any browser or in a WebView from the mobile app's "Dapur" entry; login by a kitchen user's PIN, permission `kitchen.view`
- [ ] Live updates over WebSocket subscription; falls back to 3 s polling
- [ ] Ticket card: order no, table/type, elapsed timer, course, lines with modifiers/notes/seat; colours turn at `kitchen.warn_seconds_1` and `kitchen.warn_seconds_2`; sound on new ticket and on void
- [ ] Item tap toggles line done; ticket auto-completes when all lines done; "Bump" completes the ticket; "Recall" restores the last bumped ticket on this station within `kitchen.recall_window_minutes`
- [ ] "All day" panel counts pending quantity per item across tickets
- [ ] Voided lines shown struck through with "(VOID)" for 60 s
- [ ] Station in mode `both` prints and displays; in `kds` mode with `print_when_kds_offline`, the hub prints a ticket when no KDS client for that station has been seen for 30 s
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-039: Ready and served states back to the floor
**Description:** As a waiter, I want to know when a table's food is ready so that I can run it.

**Acceptance Criteria:**
- [ ] Bumping a ticket marks its order lines `ready`; the mobile table card and order screen show a "Siap" badge and count; waiter taps "Served" per line or per order to set `served`
- [ ] Optional expo mode: setting `kitchen.expo_station_id`; when set, tickets become `ready` only after expo bumps
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### Phase 5 — Payments & cash

### US-040: Tenders configuration
**Description:** As an owner, I want to define the payment methods each outlet accepts (Tunai, EDC BCA, QRIS, GoPay, Transfer) so that the cashier picks from my list.

**Acceptance Criteria:**
- [ ] Table `tenders(id, outlet_id, name, kind cash|card|qris|ewallet|transfer|other, requires_reference bool, required_fields text[], opens_drawer bool, counts_in_drawer bool, active, sort)`; seeded per outlet with Tunai (cash) and QRIS
- [ ] `required_fields` is a subset of `reference`, `approval_code`, `card_last4`, `card_type` (debit|credit), `acquirer` (e.g. BCA, Mandiri); an EDC tender seeds with approval code, last 4 and acquirer required
- [ ] `kind=cash` is the only tender subject to cash rounding; `counts_in_drawer` decides inclusion in expected cash
- [ ] No surcharge field on purpose (QRIS/card surcharging is prohibited)
- [ ] Adds `order_types.default_tender_id` (nullable, US-095): a platform order type preselects its tender at payment, e.g. GoFood → tender "GoFood" (`kind=other`, no drawer, not in expected cash; the platform settles later)
- [ ] Typecheck/lint passes

### US-041: Take payment, split tender and cash rounding
**Description:** As a cashier, I want to take one or more payments against an order, with change for cash and a reference number for non-cash, and have cash rounded per outlet policy.

**Acceptance Criteria:**
- [ ] Table `payments(id uuid client, order_id, tender_id, amount, tendered, change, reference, approval_code, card_last4, card_type, acquirer, status captured|voided, taken_by, shift_id, created_at, voided_at, void_reason, voided_by)`
- [ ] `payment.take({id, orderId, tenderId, amount, tendered?, reference?, approvalCode?, cardLast4?, cardType?, acquirer?, expectedVersion})`: rejects amount > remaining due (`BAD_REQUEST`), requires an open shift when `shifts.required_to_sell`, requires every field in the tender's `required_fields` (`BAD_REQUEST` naming the missing field)
- [ ] Rules function `cashRounding(due, step, mode)` with settings `rounding.cash_step` (0/50/100/500/1000, default 100) and `rounding.mode` (`nearest` default, `down` always rounds down, `up` always rounds up); applied only to the cash portion; tests for each mode
- [ ] Every rounding is proven by an append-only row `cash_roundings(id uuid, order_id, payment_id, due_before int, due_after int, amount int, step, mode, created_by, created_at)` written in the same transaction as the cash payment; the order's rounding total equals the sum of its rows; a payment void writes a reversing row, never deletes
- [ ] Rounding shows as its own line "Pembulatan" on the receipt and in reports, sourced from `cash_roundings`
- [ ] Fast-cash buttons (exact, next 10k/20k/50k/100k) and a change display
- [ ] When payments reach the total the order becomes `paid`, `closed_at` set, table freed, `bill_no` assigned (US-027); partial payments leave it open with "Sisa Rp X"
- [ ] Repeating `payment.take` with the same id returns the stored payment (double tap safe); test
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-042: Bill, receipt and drawer
**Description:** As a cashier, I want to print a pre-payment bill and a receipt, reprint either, and open the cash drawer.

**Acceptance Criteria:**
- [ ] Receipt renderer (rules function, tested) outputs: outlet name/address/phone, optional NPWP, bill no, order no, business date and time, cashier, table/pax or order type, lines with qty/price/modifiers, discounts, subtotal, service charge line, tax lines per type with rate (a tax type at 0% prints no line), rounding line, total, each payment with tender name and reference, change, "Harga sudah termasuk pajak" or "Harga belum termasuk pajak dan biaya layanan" per settings, footer text, reprint marker "SALINAN" on reprints
- [ ] Bill (tagihan) prints the same without payments and marks the table `billed`
- [ ] Settings `receipt.auto_print_on_payment`, `receipt.copies`, `receipt.header`, `receipt.footer`, `receipt.show_tax_breakdown`, `receipt.paper_width`
- [ ] Cash drawer kick sent through the receipt printer when the tender `opens_drawer`; "No sale" open guarded by `drawer.no_sale` and logged as a drawer entry
- [ ] Reprint guarded by `payment.reprint` and logged
- [ ] Typecheck/lint passes

### US-043: Refund and payment void
**Description:** As a manager, I want to void a payment taken by mistake before the shift closes, or refund a paid bill in full or in part, with reason and approval.

**Acceptance Criteria:**
- [ ] `payment.void({paymentId, reason})` allowed only while the payment's shift is open; sets `voided_at`, order returns to open with remaining due
- [ ] `refund.create({id, orderId, lineIds?|amount, tenderId, reason, note})` inserts `refunds(id, order_id, payment_id nullable, amount, tender_id, reason, note, by, approved_by, created_at)`; never edits the original payment; order status stays `paid` with `refunded_total`
- [ ] Permissions `payment.void`, `payment.refund`; override flow supported; both appear in the corrections report and reduce expected cash when the tender is cash
- [ ] Refund receipt printed
- [ ] Typecheck/lint passes

### US-044: Reopen a paid order
**Description:** As a manager, I want to reopen a paid bill to fix a mistake, with the original payments kept and audited.

**Acceptance Criteria:**
- [ ] `order.reopen({orderId, reason})` guarded by `order.reopen`; allowed only within `orders.reopen_window_hours` (setting, default 24) and while the business day is not closed
- [ ] Reopened order status `open`, payments stay captured, adding lines increases due; removing sent lines requires void; closing again with due ≤ 0 marks paid, negative due requires a refund row
- [ ] Audit row with before/after totals
- [ ] Typecheck/lint passes

### US-045: Shifts and drawer entries
**Description:** As a cashier, I want to open a shift with a starting float, record pay-ins and pay-outs, and close with a counted amount.

**Acceptance Criteria:**
- [ ] Tables `shifts(id, outlet_id, device_id, opened_by, opened_at, opening_float, closed_by, closed_at, expected_cash, counted_cash, variance, notes, status open|closed)`, `drawer_entries(id, shift_id, kind pay_in|pay_out|no_sale, amount, reason, by, created_at)`
- [ ] One open shift per device; `shifts.required_to_sell` blocks payments without one (`PRECONDITION_FAILED` "Buka shift dulu.")
- [ ] Expected cash = float + cash payments − cash refunds − cash voids + pay-ins − pay-outs (rules function, tests)
- [ ] Close: counted by denomination or total; `shift.close_blind` hides expected until after entry; variance stored; `shifts.block_close_with_open_orders` (setting) refuses close while orders opened in this shift are unpaid
- [ ] A variance whose absolute value exceeds `shifts.variance_approval_threshold` (setting, default Rp 20.000) needs an approver with `shift.approve_variance` through the override flow (US-010); cashier and approver are both stored on the shift
- [ ] X report: print or view a mid-shift report (same figures as the close report, marked "X — shift belum ditutup") at any time without closing, guarded by `shift.view_expected`
- [ ] Shift report printed on close: sales by tender, discounts, voids, refunds, expected vs counted
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-046: Business day close and Z report
**Description:** As a manager, I want to close the business day and get a Z report so that daily totals are frozen.

**Acceptance Criteria:**
- [ ] `day.close(outletId, businessDate)` requires all shifts closed and no open orders for that date; writes `day_closes(outlet_id, business_date, closed_by, closed_at, totals jsonb)`
- [ ] Z report: gross sales, discounts, net, service charge, tax per type, rounding, total collected per tender, refunds, voids/comps counts and amounts, order count, pax, average per order, cash variance across shifts
- [ ] Reports of a closed day are immutable; late payments after close go to the current business date and are flagged
- [ ] Setting `business_day.auto_close_at` (time) optionally auto-closes if the conditions hold
- [ ] Typecheck/lint passes

### US-047: Desktop payment and cashier screens
**Description:** As a cashier, I want the desktop to show open orders, tables, and a payment screen tuned for speed.

**Acceptance Criteria:**
- [ ] Left: open orders list / table map toggle; centre: order detail; right: actions (Bill, Bayar, Diskon, Void, Pindah, Split)
- [ ] Quick-service mode: "Pesanan baru" opens a takeaway order with the menu grid, cart and Bayar on one screen, no table step; a cash sale of plain items is done in ≤ 3 taps after adding items
- [ ] Payment dialog: tender buttons, numeric pad, fast-cash, fields from the tender's `required_fields`, running "Sisa", change; Enter confirms
- [ ] Keyboard shortcuts for tender selection and confirm
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-091: Customer display
**Description:** As a customer at the counter, I want a second screen facing me that shows my order and total so that I can check it before paying.

**Acceptance Criteria:**
- [ ] Desktop setting (device-level) enables a customer display window on a chosen monitor, full screen
- [ ] Shows outlet name/logo, current order lines with qty and price, discounts, service charge, tax, rounding, total, and after payment the tendered amount and change; idle screen shows the outlet name
- [ ] Updates within 1 s of any cart change; totals come from the same pricing function as the receipt
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 6 — Sync & devices

### US-048: Device registration
**Description:** As an owner, I want each desktop and tablet registered to an outlet so that the hub and the cloud know which devices may connect and sync.

**Acceptance Criteria:**
- [ ] Table `devices(id, outlet_id, kind desktop|mobile|kds, name, registered_by, registered_at, last_seen_at, revoked_at)`; mobiles and client desktops register with the hub; the hub desktop registers with the cloud by owner/manager login when the sync service is enabled and receives a device token (long-lived, revocable) used for sync
- [ ] No licence, edition or outlet-count enforcement anywhere (honour system): no expiry, no grace period, no admin lock, no refused backoffice login
- [ ] Revoking a device stops its token and forces re-registration
- [ ] Typecheck/lint passes

### US-049: Background sync service and push (outlet events to cloud)
**Description:** As the hub, I push every transactional and master-data event to the cloud in order so that the cloud holds a complete copy of the outlet.

**Acceptance Criteria:**
- [ ] Sync runs in a background service on the hub PC, a separate process from the API and the Electron window; it can be enabled, disabled and restarted from the sync panel; when it is not running nothing syncs and selling is unaffected (Terminal edition)
- [ ] On every start and on every offline → online transition the service pushes all pending local events first, and pulls (US-050) only after the push has caught up
- [ ] `sync.push({deviceToken, events[] (≤500, ascending seq)})` on the cloud: inserts each event by id (duplicate ids are acknowledged, not re-applied), applies the payload to cloud tables in seq order inside one transaction per batch, records `received_at`, returns `ackSeq`
- [ ] The service pushes every `sync.interval_seconds` (default 15) and immediately after payment or shift close; marks `synced_at` up to `ackSeq`
- [ ] A rejected event (schema mismatch, unknown entity) is stored in `sync_rejections` on both sides with the error, skipped, and surfaced in the sync panel; it never blocks later events
- [ ] Cloud never mutates transactional rows except through events; cloud-side reports read the applied tables
- [ ] Tests: idempotent re-push, out-of-order batch refused, rejection isolation
- [ ] Typecheck/lint passes

### US-050: Sync pull (master data to outlet)
**Description:** As the hub, I pull catalogue, settings, users and roles from the cloud so that edits made in the backoffice reach the outlet.

**Acceptance Criteria:**
- [ ] Cloud keeps `change_feed(seq, outlet_id nullable, entity_type, entity_id, op upsert|delete, payload, created_at)` written by every master-data mutation
- [ ] `sync.pull({deviceToken, cursor})` returns changes for this outlet (global + outlet-specific) after `cursor`, ≤1000 per call; hub applies them by id and advances the cursor atomically
- [ ] Master-data classes: categories, items, variants, modifier groups/options, combos, outlet overrides, menu schedules, settings, users (including the argon2 hash, see Technical), roles, permissions, overrides, kitchen stations, tenders, floors/tables, discount/void reasons, promotions, customers
- [ ] A record edited on both the desktop and the cloud since the last sync is resolved last-write-wins by `updated_at`; the losing version is written to `sync_conflicts(id, entity_type, entity_id, winner, loser jsonb, resolved_at)` and listed in the sync panel and the backoffice sync monitor (US-093); rules function with tests
- [ ] Applying a change invalidates the settings cache and broadcasts `menu.changed` to LAN clients
- [ ] Pull runs on start, every `sync.interval_seconds`, and on demand ("Sinkronkan sekarang")
- [ ] Typecheck/lint passes

### US-051: Sync status panel
**Description:** As a cashier, I want to see whether the outlet is in sync so that I trust the numbers in the backoffice.

**Acceptance Criteria:**
- [ ] Top-bar indicator: green "Tersinkron", amber "N belum terkirim", red "Gagal: <reason>" with last success time
- [ ] Top-bar shows grey "Sinkronisasi mati" when the sync service is not running
- [ ] Sync panel: service status with start/stop, pending events count, last push/pull time and cursor, rejection list with payload preview and "Kirim ulang", conflict list (LWW losers), "Sinkronkan sekarang" button
- [ ] Shift close prints the pending-events count on the shift report; device deregistration refused while pending > 0 (`PRECONDITION_FAILED` "Masih ada data belum terkirim.")
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-052: Master-data edits on the desktop are local-first
**Description:** As an owner, I want the desktop's admin screens to save locally and work offline, and the sync service to carry my edits to the cloud, so that the outlet never depends on the internet.

**Acceptance Criteria:**
- [ ] The desktop renderer has one tRPC client, to the hub; admin and POS screens both write locally and show "Tersimpan" at once
- [ ] Every master-data mutation on the hub writes an event (`master.upserted` / `master.deleted` with entity type, id, `updated_at`, payload) in the same transaction, pushed by the sync service like transactional events
- [ ] The cloud applies desktop master-data events with the same LWW rule as pull (US-050), so both sides converge; the loser is kept in `sync_conflicts`
- [ ] Owned only locally and never pulled over: item availability (US-018), table status, printer assignments, device settings
- [ ] Test: desktop and cloud edit the same item price while offline; after push-then-pull both hold the later edit and one conflict row exists
- [ ] Typecheck/lint passes

### US-053: Bootstrap and restore
**Description:** As an owner, I want a new or reinstalled desktop to load the outlet's data from the cloud so that a broken PC is not a lost outlet.

**Acceptance Criteria:**
- [ ] Enabling sync on a desktop that already has local data (Terminal → Cloud upgrade): registration binds the local outlet to the cloud, then the service pushes all local history and master data before its first pull, so nothing local is lost
- [ ] Registration of an empty desktop downloads a snapshot (all master data + open transactional state: open orders, open shifts, today's tickets, reservations, availability) and sets the pull cursor
- [ ] Restore mode additionally pulls closed transactional history for the last `sync.restore_days` (default 90) for local reports
- [ ] Two hub desktops for one outlet are refused at registration ("Outlet sudah punya hub aktif, cabut dulu.") — one hub per outlet is a v1 ceiling; extra desktops join as hub clients (US-092)
- [ ] Nightly local backup: `pg_dump` to the app data dir, keep 7, path shown in settings
- [ ] Typecheck/lint passes

### US-054: Mobile resilience on a flaky LAN
**Description:** As a waiter, I want a brief Wi-Fi drop not to lose or duplicate my order.

**Acceptance Criteria:**
- [ ] Mobile keeps the last menu and floor in local storage and shows them read-only with a "Hub offline" banner when the hub is unreachable
- [ ] Mutations carry client ids; the client retries with the same id and `expectedVersion` up to 3 times with backoff; a `CONFLICT` triggers refetch and shows the diff
- [ ] An order screen left open during a drop resumes its cart; pending lines are held locally until "Kirim" succeeds and show a "Belum terkirim" chip
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-092: Second desktop as a hub client
**Description:** As an outlet with two cashier counters, I want a second desktop that works against the main desktop's API so that both counters share one set of orders.

**Acceptance Criteria:**
- [ ] Desktop first-run offers "Desktop utama (hub)" or "Desktop kasir tambahan"; a client desktop finds the hub like mobile does (mDNS / QR / manual IP, US-003) and never starts its own API, database or sync service
- [ ] The client desktop has the full cashier UI (orders, payments, shifts, reports for its outlet); its shift, drawer and printers are its own (device-level settings)
- [ ] When the hub is unreachable the client shows the same "Hub offline" behaviour as mobile (US-054)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 7 — Backoffice

### US-055: Backoffice login and outlet switcher
**Description:** As an owner or HQ staff, I want to log in to the backoffice and switch between my outlets.

**Acceptance Criteria:**
- [ ] Username/password login against the cloud; refresh token handling identical to desktop; no PIN
- [ ] Outlet switcher in the header lists outlets the user belongs to (all for global roles); every page is scoped to the selected outlet or "Semua outlet" where supported
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-056: Outlet management
**Description:** As an owner, I want to create outlets and set their identity, timezone and business-day cutoff.

**Acceptance Criteria:**
- [ ] List, create, edit, deactivate outlets; no outlet-count limit
- [ ] Device list per outlet with last seen, revoke
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-057: Users, roles and overrides
**Description:** As an owner, I want to add staff, assign a role per outlet, reset passwords and PINs, and grant or revoke single permissions.

**Acceptance Criteria:**
- [ ] Users list with search; create user (username unique (global), name, phone, initial password), deactivate; per-outlet membership and role
- [ ] Role editor: duplicate a base role into a custom role, tick permissions by group, rename, delete; base roles are read-only
- [ ] Per-user override editor, per outlet (tick several outlets to apply one change to all), showing effective permissions with the source (role / grant / revoke) of each
- [ ] Reset password and reset PIN (PIN cleared; user sets a new PIN on next mobile login), behind `staff.manage` + `canActOn` (only staff of an outlet the actor may act on; only the owner may reset the owner), audited
- [ ] Reset password clears the password lockout (US-005); reset PIN clears the PIN lockout (US-006); reset password also revokes the user's live and parked refresh tokens. Otherwise a lock clears only by waiting it out, or (PIN only) by the user's own change PIN (US-006). Users never reset their own password or PIN; they change it, knowing the password
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-058: Menu management across outlets
**Description:** As an owner, I want to manage each outlet's menu from the backoffice and reuse work between outlets.

**Acceptance Criteria:**
- [ ] Same capabilities as US-020 for the outlet picked in the outlet switcher, plus: copy a menu (categories, items, variants, add-on groups) from one outlet to another as new rows, bulk price update by category or percentage, image upload to cloud storage, CSV import/export of items per outlet
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-059: Outlet settings UI
**Description:** As an owner, I want one settings page per outlet covering every key in Appendix A.

**Acceptance Criteria:**
- [ ] Grouped form generated from the settings schema (labels, help text, validation) so that a new key needs no UI change
- [ ] Tax & service charge group shows a live example receipt calculation for a sample bill using US-025
- [ ] "Copy settings from outlet…" action
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-060: Kitchen stations, tenders and reasons UI
**Description:** As a manager, I want to configure stations, tenders, discount and void reasons per outlet.

**Acceptance Criteria:**
- [ ] CRUD screens for kitchen stations (mode, fallback), tenders (kind, reference required, drawer), discount reasons, void reasons; sort by drag
- [ ] Printer devices themselves are configured on the desktop (local hardware); station → printer mapping is local too
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-061: Transaction export for regional tax reporting
**Description:** As an owner in Jakarta, I want a per-transaction export so that the Bapenda agent (E-TRAPT) or my accountant gets every bill.

**Acceptance Criteria:**
- [ ] Export CSV per outlet and date range: bill no, order no, business date, calendar date/time, order type, subtotal, discount, service charge, tax per type, rounding, total, tender(s), reference, cashier, status (paid/refunded/void)
- [ ] Available on the desktop (local data) and the backoffice (cloud data); both produce identical rows for a synced range (test with a fixture)
- [ ] Read-only SQL view `v_tax_transactions` on both databases with the same columns for agent integration
- [ ] Permission `report.export`
- [ ] Typecheck/lint passes

### US-062: Cross-outlet dashboard
**Description:** As an owner, I want today's numbers across outlets on one screen.

**Acceptance Criteria:**
- [ ] Cards per outlet: sales today, orders, average bill, open orders, sync lag (minutes since last push), last shift status
- [ ] Date picker and comparison to the same weekday last week
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-093: Backoffice sync monitor
**Description:** As an owner or admin, I want to see each outlet's sync health and conflicts so that I catch problems before the numbers are wrong.

**Acceptance Criteria:**
- [ ] Per outlet: hub device, sync service last seen, last successful push and pull, pending count reported by the hub, rejected events, clock skew flag (`received_at − created_at` > 5 min)
- [ ] Conflict list from `sync_conflicts` (entity, both versions, winner, time) with "Tandai selesai"; resolving never rewrites the winner, it only records `resolved_at`
- [ ] Permission `sync.manage`
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 8 — Reservations & waitlist

### US-063: Reservations
**Description:** As a host, I want to record a reservation with name, phone, party size, time and table so that the table is held.

**Acceptance Criteria:**
- [ ] Table `reservations(id, outlet_id, customer_name, phone, pax, starts_at, duration_minutes, table_ids[], status booked|seated|no_show|cancelled|closed, notes, source phone|walk_in|whatsapp, created_by, created_at, updated_at, seated_order_id, cancel_reason)`
- [ ] Overlap check per table: a booking overlapping another booking on the same table returns `CONFLICT` "Meja sudah dipesan jam itu." (rules function, tests, honours `reservations.turn_minutes` default duration and `reservations.hold_before_minutes`)
- [ ] Table shows `reserved` from `starts_at − hold_before_minutes` until seated or `starts_at + no_show_after_minutes`
- [ ] Reservations are owned by the hub: written from the desktop and mobile only, with client ids and last-write-wins by `updated_at` between devices (the loser is logged in `sync_conflicts`); the cloud receives a read-only copy and the backoffice cannot create or edit them
- [ ] Typecheck/lint passes

### US-064: Seat, no-show, cancel
**Description:** As a host, I want to seat a reservation into an order, mark a no-show, or cancel with a reason.

**Acceptance Criteria:**
- [ ] "Seat" opens (or creates) the dine-in order on the reserved tables with pax and customer name, sets `seated`
- [ ] No-show and cancel require a reason; a `closed` status is set when the seated order is paid
- [ ] Seating a table that has an open order asks to merge into it or pick another table
- [ ] Permissions `reservation.create`, `reservation.update`
- [ ] Typecheck/lint passes

### US-065: Reservation screens
**Description:** As a host on mobile or desktop, I want today's reservations as a timeline and a list with quick actions.

**Acceptance Criteria:**
- [ ] Day view grouped by hour with status colours; create/edit sheet; search by name/phone; upcoming badge on the table map
- [ ] "Kirim WhatsApp" opens `wa.me/<phone>?text=<template>` with the booking details (setting `reservations.whatsapp_template`)
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-066: Walk-in waitlist
**Description:** As a host, I want a queue of waiting walk-ins with a quoted wait so that I can seat them in order.

**Acceptance Criteria:**
- [ ] Table `waitlist(id, outlet_id, name, phone, pax, quoted_minutes, status waiting|notified|seated|left, created_at, seated_at)`; queue number per business date
- [ ] Actions: notify (wa.me link), seat (same as US-064), left; average actual wait shown for the last 10 seated
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-094: Reservation deposits
**Description:** As a host, I want to take a deposit (uang muka) when booking so that large parties commit, and have it count toward the bill.

**Acceptance Criteria:**
- [ ] A deposit is a payment row (client id, any tender, `required_fields` apply) with `reservation_id` and no order yet, taken in an open shift and counted in that shift's expected cash when cash
- [ ] Seating the reservation (US-064) attaches its deposits to the order; they reduce the remaining due and print as "Uang muka" on the bill and receipt
- [ ] No-show or cancel: the deposit is either forfeited (reason, permission `reservation.update`, reported as other income) or refunded through a refund row (US-043); never deleted
- [ ] Deposit shown on the reservation card and in the payments report
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### Phase 9 — Reports

Every report runs on the desktop against local data (its own outlet) and in the backoffice against cloud data (any outlet or all). Both use the same query module and a shared fixture test proving identical output for the same rows. All reports filter by business date range and show the calendar month for tax. Backoffice reports carry a freshness stamp per outlet ("Data s/d 14:32") from the last applied push, and list outlets that still have pending data.

### US-067: Sales summary
**Description:** As an owner, I want a sales summary by day and order type so that I know how the outlet performed.

**Acceptance Criteria:**
- [ ] Gross, discounts, net, service charge, tax per type, rounding, total, refunds, order count, pax, average bill, by day; by order type; export CSV
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-068: Item and category sales
**Description:** As an owner, I want sales per item and category so that I know what sells.

**Acceptance Criteria:**
- [ ] Quantity and net sales per item/variant/modifier and per category; comps shown separately; sort and search; export CSV
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-069: Payments and cash
**Description:** As a manager, I want collected amounts per tender and cash variance per shift so that I can reconcile the drawer.

**Acceptance Criteria:**
- [ ] Collected per tender, refunds per tender, cash variance per shift, pay-in/out list, no-sale count
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-070: Tax report
**Description:** As an owner, I want a monthly tax report so that I can file the PBJT return.

**Acceptance Criteria:**
- [ ] Per calendar month and per business date: taxable base per tax type, service charge base, tax amount, untaxed sales (tax type `none` or rate 0%); matches the sum of bills in US-061 for the same range (test)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-071: Corrections report
**Description:** As an owner, I want every correction listed with actor and approver so that I can spot abuse.

**Acceptance Criteria:**
- [ ] Every void, comp, discount, price override, refund, payment void, reopen, cancelled order: time, order, amount, reason, actor, approver; filters by kind and user
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-072: Hourly, staff and table reports
**Description:** As a manager, I want hourly, staff and table reports so that I can plan staffing and seating.

**Acceptance Criteria:**
- [ ] Sales and orders per hour of the business day; per waiter (orders opened) and per cashier (payments taken); table turnover and average duration per table
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-073: Shift and day reports reprint
**Description:** As a manager, I want to view and reprint past shift and Z reports.

**Acceptance Criteria:**
- [ ] Past shift and Z reports viewable and reprintable from both apps; optional daily email of the Z report from the cloud (`reports.daily_email_to`)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 10 — Inventory

Stock is a per-outlet ledger. Every movement is an append-only `stock_ledger` row with a client id, written by the hub (sales depletion, waste, local adjustments, receiving on site) or the cloud (purchase orders, transfers, backoffice adjustments). Both sides sync their rows to each other; on-hand = sum of the ledger, so there are no conflicts.

### US-074: Ingredients and units
**Description:** As an owner, I want ingredients with units and costs so that recipes can be costed.

**Acceptance Criteria:**
- [ ] Tables `ingredients(id, name, base_unit, purchase_unit, conversion_factor, cost_per_base_unit, par_level, active)`, `stock_on_hand` materialised per outlet
- [ ] Unit conversion rules function with tests (e.g. 1 karton = 24 botol = 24 × 330 ml)
- [ ] Typecheck/lint passes

### US-075: Recipes
**Description:** As an owner, I want recipes per item, variant and modifier so that sales deplete stock.

**Acceptance Criteria:**
- [ ] `recipes(target_type item|variant|modifier_option, target_id, ingredient_id, qty_base_unit)`; an item may also be a finished good tracked directly (`items.track_stock`)
- [ ] Recipe cost roll-up shown in the item editor
- [ ] Typecheck/lint passes

### US-076: Stock ledger and auto depletion
**Description:** As a developer, I need an append-only stock ledger that sales deplete automatically.

**Acceptance Criteria:**
- [ ] `stock_ledger(id uuid, outlet_id, ingredient_id, qty_delta, kind sale|void_return|waste|adjustment|receive|transfer_in|transfer_out|count, ref_type, ref_id, reason, by, created_at)`
- [ ] Sending lines depletes per recipe; voiding an unmade line returns stock, comps do not; combos deplete components
- [ ] Negative stock allowed but flagged (setting `inventory.allow_negative`)
- [ ] Tests: depletion math, void return
- [ ] Typecheck/lint passes

### US-077: Adjustments and waste
**Description:** As a manager, I want to record waste and manual adjustments with reasons.

**Acceptance Criteria:**
- [ ] Desktop and backoffice screens to record waste (reason list `inventory.waste_reasons`, optional photo note) and manual adjustments; permission `inventory.adjust`
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-078: Stock opname (count)
**Description:** As a manager, I want to count stock and post the variance.

**Acceptance Criteria:**
- [ ] `stock_counts(id, outlet_id, status draft|posted, started_by, posted_by, posted_at)` with lines (expected, counted, variance); posting writes ledger rows of kind `count`; partial counts by category allowed
- [ ] Variance report per count
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-079: Suppliers, purchase orders, receiving
**Description:** As an owner, I want suppliers and purchase orders with receiving so that stock and cost stay current.

**Acceptance Criteria:**
- [ ] `suppliers`, `purchase_orders(status draft|sent|partial|received|cancelled)`, `purchase_order_lines(qty ordered, qty received, unit cost)`; receiving on the desktop or backoffice writes `receive` ledger rows and updates cost (moving average)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-080: Transfers between outlets
**Description:** As an owner, I want to move stock between outlets and see what is in transit.

**Acceptance Criteria:**
- [ ] `stock_transfers(from_outlet, to_outlet, status draft|sent|received)`; sending writes `transfer_out` rows at the source, receiving writes `transfer_in` at the destination; in-transit quantity visible
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-081: Low-stock alerts, COGS and variance
**Description:** As an owner, I want low-stock alerts and COGS/variance reports.

**Acceptance Criteria:**
- [ ] Ingredients under par listed on the desktop home and backoffice dashboard; optional daily email
- [ ] COGS per item and gross margin report from recipe cost at sale time; theoretical vs actual usage between two counts
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### Phase 11 — Promotions & customers

### US-082: Automatic promotion rules
**Description:** As an owner, I want automatic promotions by item, category, quantity, time and order type.

**Acceptance Criteria:**
- [ ] `promotions(id, name, outlet_ids[], kind item_percent|item_amount|bill_percent|bill_amount|buy_x_get_y, targets, min_qty, min_subtotal, days, start_time, end_time, valid_from, valid_to, order_type_ids, stackable, priority, active)`
- [ ] Rules function `applyPromotions(order, promotions, now)` produces discount rows tagged with the promotion id, deterministic order by priority, non-stackable stops; tests
- [ ] Applied automatically on every order recompute; shown as named discount lines on the receipt
- [ ] Typecheck/lint passes

### US-083: Price lists (happy hour, order type)
**Description:** As an owner, I want time- and channel-based price lists such as happy hour.

**Acceptance Criteria:**
- [ ] `price_lists(id, outlet_id, name, order_type_ids, days, start_time, end_time, priority)`, `price_list_items(price_list_id, item_id, variant_id, price)`; the active price list overrides the item price at add-line time and is snapshotted
- [ ] Typecheck/lint passes

### US-084: Vouchers
**Description:** As an owner, I want voucher codes tied to promotions with usage limits.

**Acceptance Criteria:**
- [ ] `vouchers(code unique, promotion_id, max_uses, uses, valid_to, per_customer_limit)`; redeem at payment; redemption recorded and synced; offline redemption allowed with a soft limit, reconciled on sync (over-redemption reported, not blocked)
- [ ] Verify in browser using dev-browser skill
- [ ] Typecheck/lint passes

### US-085: Customers with consent
**Description:** As an owner, I want customer records with explicit consent and deletion support so that I comply with UU PDP.

**Acceptance Criteria:**
- [ ] `customers(id, name, phone unique, email, birthday, consent_marketing bool, consent_at, notes, deleted_at)`; creation requires explicit consent tick with the privacy notice text from `customers.privacy_notice`
- [ ] "Hapus data pelanggan" anonymises the row (name/phone/email replaced) within the app and logs the request; order history keeps the anonymised id
- [ ] "Ekspor data pelanggan" produces a file of everything stored about one customer (profile, consent, orders, loyalty ledger) for a data-subject request, guarded by `customer.manage` and logged
- [ ] Phone numbers print masked on receipts and kitchen tickets (`0812-xxxx-3456`)
- [ ] Retention setting `customers.retention_months` with a scheduled anonymisation job in the cloud
- [ ] Typecheck/lint passes

### US-086: Attach customer to order
**Description:** As a cashier or waiter, I want to attach a customer to an order.

**Acceptance Criteria:**
- [ ] Search by phone/name on desktop and mobile; new customer in two fields; customer name on kitchen ticket and receipt
- [ ] Verify in browser using dev-browser skill (Expo web) or simulator
- [ ] Typecheck/lint passes

### US-087: Loyalty points
**Description:** As an owner, I want loyalty points earned and redeemed at checkout.

**Acceptance Criteria:**
- [ ] Settings `loyalty.enabled`, `loyalty.earn_per_rupiah`, `loyalty.redeem_value_per_point`, `loyalty.min_redeem_points`; `loyalty_ledger(id, customer_id, order_id, points_delta, kind earn|redeem|adjust|expire, created_at)` append-only, synced
- [ ] Earn on paid orders (net after discount); redeem as a payment-like discount row at checkout; balance = ledger sum; offline redeem allowed against the last synced balance
- [ ] Typecheck/lint passes

## 6. Functional requirements

Platform
- FR-1: One API codebase runs in `cloud` or `local` mode; the mode decides which routers are mounted (US-001).
- FR-2: The desktop app must start and serve orders with no network interface connected.
- FR-3: Mobile devices connect only to the outlet hub over LAN; they never call the cloud.
- FR-4: Every outlet-level rule listed in Appendix A is stored as data, validated by a schema, editable at runtime, versioned and audited.
- FR-5: Money is stored and computed as integer rupiah; floats are forbidden in schema and in the pricing code.
- FR-6: All transactional entities use client-generated UUIDs; repeating any transactional mutation with the same id is a no-op returning the first result.
- FR-7: Every order mutation carries `expectedVersion`; a mismatch returns `CONFLICT` and the client refetches.

Auth and access
- FR-8: Password login issues a 15-minute JWT and a rotating refresh token; the refresh token is stored hashed.
- FR-9: Mobile profiles are created only after a password login; later switches use a 6-digit PIN; parked profiles cannot refresh without the PIN.
- FR-10: `UNAUTHORIZED` ends the client session; `FORBIDDEN` never does; a wrong PIN is `UNAUTHORIZED` with `reason: 'INVALID_PIN'` and is the one 401 clients ignore.
- FR-11: Permissions are checked by name; effective permissions = role grants + user grants − user revokes; an override belongs to one outlet and applies only there.
- FR-12: Any refused overridable action can be completed by an approver's PIN entered on the same screen; actor and approver are both recorded.
- FR-13: The Owner role is global, uneditable and not assignable per outlet. Base roles are locked; the owner adjusts access with custom roles and per-outlet overrides.

Menu
- FR-14: Items have a tax type (`pbjt`, `ppn`, `none`); service charge is per bill, not per item; variants, modifier groups with min/max/required, and combos are supported.
- FR-15: Price and enabled state can be overridden per outlet; availability (sold out, countdown) is owned by the hub and works offline.
- FR-16: Sending a sold-out or off-schedule item is refused with `PRECONDITION_FAILED` and the menu refreshes.

Orders
- FR-17: Order lines snapshot name, variant, modifiers, unit price, tax type and rate and station at add time.
- FR-18: The pricing pipeline is line → line discount → bill discount (proportional) → subtotal → service charge → tax per type → cash rounding → total, rounding half-up to the rupiah at each step, in one tested pure function shared by server and clients.
- FR-19: PBJT and PPN each have an inclusive/exclusive setting; the service charge is always exclusive; tax is always charged after discounts; service charge inclusion in the tax base is a setting (`service_charge.taxable`).
- FR-20: Order numbers are gapless per outlet per business date; bill numbers are gapless per outlet and never reset.
- FR-21: Business date = timestamp shifted by the outlet cutoff in the outlet timezone; all reports, shifts and numbering use it; tax reports also group by calendar month.
- FR-22: Sent lines are never edited or deleted; corrections are void or comp rows with reason, actor and approver.
- FR-23: Orders can be transferred, merged and split (items, seats, equal, amount) with totals that reconcile to the rupiah.
- FR-24: Courses can be held and fired; a sent line's course is fixed.

Kitchen
- FR-25: Each station is `print`, `kds` or `both`; a `kds` station may fall back to printing when no KDS client has been seen for 30 s.
- FR-26: KDS supports item bump, ticket bump, recall, two-threshold timers, all-day counts and void marking, over WebSocket with polling fallback.
- FR-27: Print jobs are persisted, retried and reprintable.

Payments and cash
- FR-28: Tenders are configured per outlet with their required fields; only cash is rounded (nearest/down/up, default nearest Rp 100); every rounding is an append-only `cash_roundings` row and a visible receipt line; no surcharges.
- FR-29: Split tender is supported; a payment cannot exceed the remaining due; duplicate payment ids are ignored.
- FR-30: Payment void is allowed only in the open shift; refunds are separate rows; reopening a paid order is gated, time-limited and audited.
- FR-31: Shifts have a float, pay-in/out entries, expected vs counted cash, optional blind count; the business day can be closed only with all shifts closed and no open orders, producing an immutable Z report.
- FR-32: Receipts show every line of the pricing pipeline, each payment, the tax-inclusive/exclusive note, and are marked on reprint.

Sync
- FR-33: Transactional data flows outlet → cloud as ordered, idempotent events; the cloud never edits it.
- FR-34: Sync is done by a background service on the hub PC; without it nothing syncs and the outlet works fully. On start and on reconnect it pushes pending local events first, then pulls.
- FR-35: Master data is edited on both the desktop (locally, offline) and the backoffice; the same record edited on both sides resolves last-write-wins by `updated_at` with the loser kept in `sync_conflicts`. Owned only locally: availability, table status, printer mapping, device settings.
- FR-36: Reservations are written only on the desktop and mobile (last-write-wins between devices); the cloud holds a read-only copy. Stock ledger, loyalty ledger and voucher redemptions are append-only and may be written on both sides.
- FR-37: A rejected event never blocks later events and is visible in the sync panel; pending event count is visible at all times; device deregistration is refused with pending events.
- FR-38: No licence enforcement (honour system): nothing expires, locks or counts outlets.

Backoffice
- FR-39: The backoffice manages outlets, devices, users, roles, overrides, menu, settings, stations, tenders, reasons, promotions, inventory, customers and reports; it never takes orders or payments.
- FR-40: A per-transaction export and a read-only SQL view exist on both databases with identical columns.

Reservations, reports, inventory, promotions
- FR-41: Reservations detect table overlap, hold tables before the start, and seat into an order.
- FR-42: Every report runs identically on local and cloud data from a shared query module.
- FR-43: Stock is an append-only per-outlet ledger; sending lines depletes by recipe; counts, waste, receiving and transfers are ledger rows.
- FR-44: Promotions apply automatically by priority; price lists override prices by time and order type; vouchers redeem offline with reconciliation.
- FR-45: Customer records require consent, support anonymisation on request and a retention job.

## 7. Non-goals (out of scope for this PRD)

- QR self-order and digital menu for guests (staff-operated only for now; the menu API and order model must not block it: order `source` column reserved).
- Delivery aggregator integrations (GoFood, GrabFood, ShopeeFood).
- Payment gateway integration (dynamic QRIS, card, e-wallet APIs, online refunds). Non-cash tenders are recorded manually with a reference number.
- Tips (none, neither separate nor inside service charge); house accounts / corporate credit.
- Regional tapping-box adapters beyond the CSV export and SQL view.
- Accounting, payroll, attendance beyond login records.
- Barcode scanner, weighing scale.
- Two hubs in one outlet, or a mobile device acting as hub (a second desktop joins as a hub client, US-092).
- Hotel restaurants: the Permenaker 7/2016 service-charge distribution report and any PMS integration.
- macOS desktop builds (Windows only for now).
- Licence enforcement of any kind.
- Deferred for later: PKP mode (NPWP serial receipts, PPN lump-sum export), WhatsApp/hosted/email e-receipts, per-cashier shift mode, MDR and settlement reconciliation, draft/publish menu, menu quick-note chips, loyalty tiers and per-purpose consent, regulatory appendix and glossary.
- Multi-currency, multi-language beyond Indonesian UI copy with English code.
- Marketplace of third-party integrations / public API.

## 8. Design considerations

- UI copy Indonesian; code, identifiers and commit messages English.
- Touch-first on desktop and mobile: 48 dp minimum targets, one-tap add for plain items, no blocking spinners on the order path, optimistic updates reconciled on `CONFLICT`.
- Every error message states the next action.
- Status colours consistent across apps: free grey, seated green, warn-1 amber, warn-2 red, billed blue, reserved purple.
- KDS is high contrast, readable at 2 m, no hover-only affordances.
- Settings forms are generated from the schema so that adding a key does not need a UI change.
- Shared UI packages: web components for desktop and backoffice; RN mirrors for mobile.

## 9. Technical considerations

Stack (current monorepo, plus the pieces still missing)
- Monorepo: Turborepo + pnpm. API: NestJS 11 + `nestjs-trpc` + Drizzle on node-postgres + Passport JWT + argon2 (all Zod in decorators inline). Mobile: Expo + expo-router + NativeWind. Desktop: electron-vite + React. Backoffice: Vite + React. Contract: generated `AppRouter` in `packages/api-contract` with shared runtime (token provider, refresh link, rules).
- **Missing, to add:** Postgres on the outlet PC via Docker (shipped `docker compose` file) or a manual Windows install, never bundled; API packaged as a child process of Electron main; the background sync service as a separate process (Windows first; macOS is not a target for now); mDNS advertise (`bonjour-service`) on desktop and `react-native-zeroconf` on mobile via an Expo config plugin (dev build); tRPC WebSocket subscriptions for LAN realtime (`ws` adapter) with polling fallback; ESC/POS printing (`node-thermal-printer` or `escpos` over TCP 9100 and USB) in Electron main; a `packages/pos-rules` package holding pricing, rounding, business-date, split, recipe and promotion rules shared by API and all clients; the KDS page served by the hub from the desktop renderer build; `pg_dump` bundled for backups; cloud object storage for item images; e-mail sender for daily reports.
- Two Postgres clusters in dev (`cloud` on 5432, `local` on 5434) already exist; run the API twice to exercise sync over real HTTP.

Architecture
- Desktop = hub: local Postgres (Docker or manual) → Electron main starts API (`local`) on `0.0.0.0:3333` → renderer and LAN clients. The renderer talks only to the hub. A separate background sync service talks to the cloud.
- Second desktop = hub client, same as mobile: no API, database or sync service of its own.
- Cloud = API (`cloud`) + managed Postgres + backoffice static site. Sync receiver and change feed live here.
- Mobile = thin client of the hub; local storage only for profiles/PINs, cached menu/floor, and unsent carts.
- Data ownership (see FR-33 to FR-36): transactional → hub-owned, cloud copy; master → edited on both sides, LWW with loser logged; ledgers → append both sides; reservations → hub-owned, cloud read-only.
- Users on the hub: created locally or pulled from the cloud including the argon2 password hash so that password login works offline. Hash sync is acceptable because the hub already holds all outlet data; hub disk should be encrypted (deployment note).
- LAN transport is plain HTTP in v1 (see Open Questions); JWTs are short-lived; hub port must not be exposed beyond the outlet LAN.
- Realtime: hub broadcasts `order.changed`, `table.changed`, `ticket.changed`, `menu.changed`, `availability.changed` over WebSocket; every client also refetches on reconnect.
- Business date computed on the hub; cloud stores both `created_at` and `business_date` from the event and never recomputes it.
- Testing: rules packages unit-tested without DB; DB tests on the `_test` database with truncation between cases; a sync integration test runs two API processes against two databases.

Sync protocol (summary; details in Appendix C)
- Push first: on start and on reconnect the sync service drains pending events before pulling.
- Push: hub sends events in `seq` order, batches ≤500, cloud acks the highest applied `seq`; duplicates acknowledged; rejections isolated.
- Pull: cloud change feed with a per-device cursor; applied by id with LWW on `updated_at`; deletes carried as tombstones.
- Ordering guarantees: within an outlet, events are applied in hub `seq` order, so parent rows always precede children.
- Clock: hub time is authoritative for business dates; cloud records skew when `received_at − created_at` exceeds 5 minutes and shows it in the device list.

Performance
- Menu of 1,000 items with 200 modifiers loads on mobile in < 1 s from the hub on Wi-Fi.
- Order mutations round-trip on LAN in < 150 ms p95; KDS receives a new ticket within 1 s.
- Hub handles 10 mobile clients + 3 KDS screens on a mid-range PC.

## 10. Success metrics

- 0 duplicate payments or orders in a retry/double-tap test suite and in production audit logs.
- Sales continue with the WAN unplugged for a full business day in an end-to-end test; 100% of events reach the cloud after reconnect with counts matching.
- Backoffice Z-report total equals the desktop Z-report total for every closed business day (automated reconciliation check).
- Pricing engine fixtures match hand-computed receipts including Jakarta's after-discount, service-charge-in-base rule.
- Median time to add an item to an order on mobile < 2 taps; payment for a cash sale < 3 taps.
- Tax report for a month matches the per-transaction export sum to the rupiah.
- Manager override recorded with approver on 100% of overridden actions.

## 11. Open questions

1. LAN transport security: plain HTTP on a dedicated outlet SSID for v1 (current decision), or self-signed TLS pinned via the pairing QR before the first pilot?
2. Should service charge be excluded from the tax base by default outside Jakarta, or default to included everywhere with a per-outlet switch (current proposal: included, switchable)?
3. Should comped lines deplete inventory (proposal: yes) and count in item sales (proposal: yes, flagged)?
4. Backoffice users editing the menu while an outlet is offline: accept that the outlet sees the change only on reconnect (proposal: yes, with "last pulled" shown in the backoffice menu page)?
5. Daily Z report e-mail from the cloud only, or also WhatsApp via a third-party gateway later?

## 12. Decisions (2026-09-30)

Settled by the owner when the earlier spec was merged into this PRD. Do not reopen without the owner.

- **Licensing:** none. Honour system; no expiry, grace period, admin lock or outlet limit.
- **Tenancy:** one business per deployment — one app, one database, one company. No `companies` table and no `company_id` column anywhere. Master data without an `outlet_id` (ingredients, customers, users) is global to the deployment; deployment-level values (lock timers) are global settings, not outlet settings; brand and receipt identity are per outlet.
- **Menu per outlet (2026-10-01):** each outlet has its own menu, brand and settings — two outlets may be different brands selling different food. Categories, items, add-on groups and kitchen stations carry `outlet_id`; names are unique per outlet. Ingredients stay global (one list; stock is per outlet, US-074–US-080), so recipes of any outlet use the same ingredients. Who edits a menu is a permission (`menu.manage`, `category.edit`): the outlet Manager role by default, reassignable per user with overrides (US-009) — the client decides.
- **Service charge per bill (2026-10-01):** service charge applies to the whole bill, decided by its order type's `service_charge` flag (US-095; default Dine In only; takeaway, delivery and platform types carry none). Order types are per-outlet data, not a fixed list: GoFood, GrabFood and ShopeeFood are `delivery`-kind rows the owner adds. Items have no service-charge flag. Something sold without service charge, such as merchandise, is rung up as its own bill (e.g. a takeaway order), not as an exempt line on a dine-in bill.
- **Topology:** mobile always connects to the desktop over the LAN. The desktop is local-first for everything, admin included. A background sync service syncs with the cloud; without it there is no cloud sync. On reconnect the service pushes local changes first, then pulls; master data edited on both sides resolves last-write-wins with the loser logged.
- **Database on the desktop:** Postgres via Docker or manual install; not embedded.
- **Reservations:** written on the desktop and mobile only, last-write-wins; backoffice read-only.
- **Pricing defaults:** exclusive prices; cash rounding nearest Rp 100 (modes nearest, always down, always up), every rounding stored as proof in `cash_roundings`.
- **Roles:** base roles include Supervisor and Accountant.
- **Roles and permissions (2026-10-01):** a user has one role per outlet (`outlet_staff.role_id`); Owner is the only global role. Base roles are locked and owned by the seed; the owner adds custom roles (usually a copy of a base role) for a group, and per-outlet overrides for one person. Overrides always name an outlet — no global overrides. One permission per action: the old `*_request`/`*_approve` pairs are gone, and a refused action is approved through the manager PIN override (US-010, `approval.grant`). Permission names the code already checks keep their finer names (Appendix B).
- **Desktop login:** username and password; no PIN profile picker. Revised 2026-10-02: every desktop user sets a PIN right after their first password login; locking parks the session and the same user reopens it with that PIN on a keypad; the account menu changes PIN and password.
- **Stock:** deducted at send only.
- **In scope:** reservation deposits, customer display, second desktop as a hub client, order search, park/recall takeaway, card fields on tenders, variance approval, X report, backoffice sync monitor, report freshness stamp, customer data export and phone masking, LAN/USB/Bluetooth/serial printers.
- **Out of scope:** tips, self-pickup as its own type (takeaway covers it), hotel-restaurant rules, macOS.
- **Kept from this PRD as written:** LAN plain HTTP for v1, QR/mDNS pairing, cloud snapshot restore, outlet-only settings without effective dates, `tax_type` model, phase order, default timers and retention.

## Appendix A — Outlet settings catalogue (all runtime-editable)

Global settings (one set per deployment, see US-004): `security.pin_idle_lock_seconds` (int, 120, mobile) and `security.desktop_lock_seconds` (int, 0 = off). Everything below is per outlet. Rates are stored as basis points (1000 = 10%); every screen shows and accepts percent. The PIN is always 6 digits (not a setting), and the service charge is always added on top of prices (not a setting).

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `identity.receipt_name` | string | outlet name | printed header; deferred, decide with US-042 |
| `business_day.cutoff_time` | HH:mm | 04:00 | service after midnight belongs to previous date |
| `business_day.auto_close_at` | HH:mm or null | null | |
| `tax.rates` | map type→basis points | `{pbjt: 1000, ppn: 1100}` | per item `tax_type`; 0 = exempt |
| `tax.pbjt_label` | string | "PBJT" | printed on receipts (PBJT, PB1, Pajak Restoran) |
| `tax.pbjt_inclusive` | bool | false | menu prices exclude PBJT |
| `tax.ppn_inclusive` | bool | true | retail prices include PPN |
| `tax.npwpd` | string | "" | regional taxpayer number for PBJT |
| `service_charge.name` | string | "Biaya Layanan" | printed on receipts |
| `service_charge.rate` | basis points | 0 | |
| `service_charge.taxable` | bool | true | PBJT is charged on subtotal + service charge |
| `rounding.cash_step` | 0/50/100/500/1000 | 100 | cash only |
| `rounding.mode` | nearest/down/up | nearest | down = always round down, up = always round up; each rounding stored in `cash_roundings` |
| `orders.require_table_for_dine_in` | bool | true | |
| `orders.require_pax` | bool | false | |
| `orders.number_format` | string | `{type_prefix}{seq:03}` | |
| `orders.reopen_window_hours` | int | 24 | |
| `orders.max_line_amount` | int | 10.000.000 | open price cap |
| `discounts.reasons` | list | Promo, Komplain, Karyawan, Lainnya | |
| `discounts.max_percent_by_role` | map role→percent | Cashier 10, Manager 100 | above → approval |
| `voids.reasons` | list | Salah input, Tamu batal, Dapur habis, Lainnya | |
| `shifts.required_to_sell` | bool | true | |
| `shifts.default_float` | int | 0 | |
| `shifts.blind_count` | bool | false | |
| `shifts.block_close_with_open_orders` | bool | true | |
| `shifts.variance_approval_threshold` | int | 20.000 | abs variance above → approver |
| `receipt.paper_width` | 58/80 | 80 | |
| `receipt.auto_print_on_payment` | bool | true | |
| `receipt.copies` | int | 1 | |
| `receipt.header`, `receipt.footer` | text | "" | |
| `receipt.show_tax_breakdown` | bool | true | |
| `receipt.inclusive_note` | string | "Harga sudah termasuk pajak" | printed when every taxed line on the bill is inclusive (`tax.pbjt_inclusive` / `tax.ppn_inclusive`); otherwise "Harga belum termasuk pajak dan biaya layanan" |
| `kitchen.default_station_id` | id | first station | |
| `kitchen.consolidate_identical_lines` | bool | true | |
| `kitchen.one_ticket_per_item` | bool | false | |
| `kitchen.use_kitchen_names` | bool | true | |
| `kitchen.warn_seconds_1`, `kitchen.warn_seconds_2` | int | 300, 600 | |
| `kitchen.recall_window_minutes` | int | 10 | |
| `kitchen.expo_station_id` | id or null | null | |
| `tables.warn_minutes_1`, `tables.warn_minutes_2` | int | 60, 90 | |
| `reservations.turn_minutes` | int | 90 | |
| `reservations.hold_before_minutes` | int | 15 | |
| `reservations.no_show_after_minutes` | int | 20 | |
| `reservations.whatsapp_template` | text | template | |
| `sync.interval_seconds` | int | 15 | |
| `sync.restore_days` | int | 90 | |
| `inventory.allow_negative` | bool | true | |
| `inventory.waste_reasons` | list | Basi, Jatuh, Salah masak, Lainnya | |
| `loyalty.enabled`, `loyalty.earn_per_rupiah`, `loyalty.redeem_value_per_point`, `loyalty.min_redeem_points` | | off | |
| `customers.privacy_notice`, `customers.retention_months` | | text, 24 | |
| `reports.daily_email_to` | list | [] | cloud |

Address, phone, NPWP and timezone are outlet profile fields (US-008), not settings.

## Appendix B — Permission catalogue and base roles

One permission per action. A user without it is refused (`FORBIDDEN`); the manager PIN override (US-010) lets an approver holding the permission plus `approval.grant` complete it.

Groups and names:
- order: `order.create`, `order.edit_others`, `order.send`, `order.void_sent`, `order.comp`, `order.discount_line`, `order.discount_bill`, `order.price_override`, `order.transfer`, `order.merge`, `order.split`, `order.reopen`, `order.cancel`
- payment: `payment.take`, `payment.void`, `payment.refund`, `payment.reprint`
- shift/drawer: `shift.open`, `shift.close`, `shift.close_blind`, `shift.view_expected`, `shift.approve_variance`, `drawer.pay_in_out`, `drawer.no_sale`, `day.close`
- menu: `menu.view`, `menu.manage`, `menu.sold_out`, `menu.price`, `category.view`, `category.edit`
- table: `table.view`, `table.use` (seat, close), `table.merge`, `table.create`, `table.delete`, `table.layout_manage`
- kitchen: `kitchen.view`, `kitchen.bump`
- reservation: `reservation.view`, `reservation.create`, `reservation.update`
- inventory: `inventory.view`, `inventory.adjust`, `inventory.count`, `inventory.receive`, `inventory.transfer`
- customer: `customer.view`, `customer.manage`
- report: `report.view_sales`, `report.view_shift`, `report.view_audit`, `report.export`
- admin: `staff.manage`, `role.view`, `role.manage`, `permission.override`, `settings.manage` (deployment-wide settings), `device.manage`, `sync.manage`, `approval.grant`, `approval.unblock`
- outlet: `outlet.manage` (one outlet's profile and charges), `outlet.staff_assign` (one outlet's roster), `outlet.view_all`, `outlet.create`, `outlet.delete` (the set of outlets)

Base roles (locked; the seed owns their grants — adjust access with custom roles and per-outlet overrides):
- **Owner** (global): everything.
- **Manager**: everything except `role.view`, `role.manage`, `permission.override`, `settings.manage`, `outlet.view_all`, `outlet.create`, `outlet.delete`.
- **Supervisor**: everything Cashier has, plus `order.void_sent`, `order.comp`, `order.cancel`, `order.edit_others`, `payment.void`, `shift.view_expected`, `shift.approve_variance`, `drawer.no_sale`, `kitchen.view`, `report.view_sales`, `approval.grant`.
- **Cashier**: `order.create`, `order.send`, `order.discount_line`, `order.discount_bill` (within cap), `order.transfer`, `order.merge`, `order.split`; `payment.take`, `payment.reprint`; `shift.open`, `shift.close`, `drawer.pay_in_out`; `menu.view`, `menu.sold_out`; `table.view`, `table.use`, `table.merge`; `reservation.view`, `reservation.create`, `reservation.update`; `customer.view`, `customer.manage`; `report.view_shift`.
- **Waiter**: `order.create`, `order.send`, `order.transfer`, `order.split`, `order.merge`; `menu.view`, `menu.sold_out`; `table.view`, `table.use`, `table.merge`; `reservation.view`, `reservation.create`, `reservation.update`; `customer.view`.
- **Kitchen**: `kitchen.view`, `kitchen.bump`, `menu.view`, `menu.sold_out`.
- **Accountant** (read-only): `menu.view`, `inventory.view`, `customer.view`, `report.view_sales`, `report.view_shift`, `report.view_audit`, `report.export`.

## Appendix C — Sync protocol details

Event types (payload = full entity row after the change, plus `version`): `order.created`, `order.updated`, `order_line.added`, `order_line.updated`, `order_line.voided`, `order_line.comped`, `order.discount_added`, `order.discount_voided`, `order.split`, `order.merged`, `order.cancelled`, `order.reopened`, `payment.taken`, `payment.voided`, `cash_rounding.recorded`, `refund.created`, `shift.opened`, `drawer.entry`, `shift.closed`, `day.closed`, `ticket.created`, `ticket.updated`, `availability.changed`, `table_session.changed`, `reservation.upserted`, `waitlist.upserted`, `stock_ledger.appended`, `stock_count.posted`, `loyalty_ledger.appended`, `voucher.redeemed`, `audit.logged`, `master.upserted`, `master.deleted` (desktop master-data edits, US-052).

Push request: `{deviceToken, outletId, events: [{id, seq, type, entityId, payload, actorUserId, createdAt}]}`; response `{ackSeq, rejected: [{id, error}]}`. Cloud requires `events[0].seq == lastAckSeq + 1` else `PRECONDITION_FAILED` with the expected seq (hub resends from there).

Pull request: `{deviceToken, cursor}`; response `{changes: [{seq, entityType, entityId, op, payload}], nextCursor, hasMore}`.

Order: on start and on reconnect the service pushes until nothing is pending, then pulls.

Hub apply rules (pull): master by id, LWW on `updated_at` against any unsynced or newer local edit, loser written to `sync_conflicts`; locally owned classes (availability, table status, printers, device settings) and reservations are never pulled over; tombstone sets `deleted_at`.

Cloud apply rules (push): transactional upsert by id, ignore if stored `version` ≥ incoming; ledgers insert-ignore by id; `master.*` events LWW on `updated_at`, loser written to `sync_conflicts`; reservations stored as a read-only copy.

Failure handling: network error → retry with backoff (5 s → 5 min); 4xx schema error → rejection row; 401 device token → sync stops, panel shows "Perangkat perlu didaftarkan ulang", selling continues.

## Appendix D — Receipt example (exclusive tax, service charge, cash rounding)

```
WARUNG CONTOH
Jl. Contoh No. 1, Jakarta  |  021-000000
NPWP 00.000.000.0-000.000
Bill  000123          Order D-007
Tgl   30/09/2026 19:42   Kasir: Sari
Meja  12  (3 pax)
---------------------------------------
2x Nasi Goreng           50.000  100.000
   + Telur                          0
Diskon 10% (Promo)               -10.000
---------------------------------------
Subtotal                          90.000
Biaya layanan 5%                   4.500
PBJT 10%                           9.450
Pembulatan                            50
TOTAL                            104.000
Tunai                            150.000
Kembali                           46.000
---------------------------------------
Harga belum termasuk pajak dan biaya layanan
Terima kasih
```
