# PRD — F&B Point of Sale for Indonesia

> **Superseded by `tasks/prd.v2.md`.** Kept for history only; do not build from this file.

**Date:** 2026-09-30 · **Status:** Draft v1 · **Type:** Product requirements (greenfield; written from the brief and market research, deliberately not from existing code or specs)

---

## 0. Summary

A **local-first F&B POS for Indonesia** delivered as three apps:

| App | Role | Connectivity | Primary users |
| --- | --- | --- | --- |
| **Desktop** | The outlet terminal *and* the outlet server: owns the local database, serves mobile devices over LAN, prints, takes payment. Carries a management module so an outlet can run with no cloud. | Local-first. Works with zero internet. Syncs to cloud when present. | Cashier, outlet manager |
| **Mobile** | Waiter app: floor plan, order taking, send to kitchen, reservations. Also runs the **Kitchen Display** mode on a tablet. | LAN client of the desktop. Never talks to the cloud directly. Short offline queue for Wi-Fi blips. | Waiter, kitchen, supervisor |
| **Backoffice** | Web admin: outlets, users and roles, menu, inventory, promotions, reports, sync monitor. No cashiering, no waiter functions. | Always online, against the cloud API. | Owner, backoffice admin, accountant |

Two commercial packages, one codebase:

| Package | Contents | Multi-outlet |
| --- | --- | --- |
| **Standalone** | Desktop + Mobile. Menu, staff, settings and reports are managed inside the desktop. No cloud account needed. | Each outlet is an island: its own desktop, its own data. |
| **Cloud** | Standalone + Backoffice + sync + consolidated reporting + hosted e-receipts + integrations. | Central menu with outlet overrides, central users, cross-outlet reports, stock transfers. |

**Every commercial rule is data**: tax components (PBJT/“Pajak Restoran”, PPN), service charge, rounding, inclusive vs exclusive pricing, order types, payment methods, roles, receipts. Nothing regional or fiscal is hard-coded.

**Build order (short form):** Foundation → Counter sales → Dine-in + waiter app + kitchen printing → Kitchen Display → Cloud sync + Backoffice → Reservations + payment breadth → Inventory → Customers/loyalty/promotions → Integrations + self-order. Standalone is sellable after phase 3; Cloud after phase 4. Full detail in §11.

---

## 1. Problem statement

Indonesian F&B operators (warung, café, restaurant, small chains) run on Android-tablet POS apps that are cloud-first with shallow offline behaviour. When the internet drops, or when two devices work the same table, sales stall, tickets go missing, or cashier and dashboard disagree for hours. Public reviews of the market leaders repeatedly name the same failures: unsynced sales lost on logout, GoFood orders arriving hours late, stock discrepancies, and dashboards that lag the terminal. Meanwhile pricing is fragmented: per-outlet fees plus per-terminal caps, per-employee seats, and paid add-ons for table management, kitchen display, delivery integration and loyalty, so a full-service restaurant pays for a top tier to get basic F&B features.

Tax handling is treated as “a percentage line”. No mainstream product models the regional restaurant tax (PBJT, formerly PB1) as distinct from PPN, nor the rules that decide whether a bill is deemed tax-inclusive, nor PKP receipt fields, so operators improvise on receipts and expose themselves to regional tax reassessment.

The cost of not solving this: outlets lose sales during outages, owners lose money to undetected voids and discounts, and operators either overpay for tiers or run without a POS. A product that is genuinely local-first (a real local authority per outlet), sells without a cloud subscription, and models Indonesian tax correctly fills a gap none of the surveyed competitors occupies.

## 2. Goals

Outcomes, not outputs. Measurement detail in §12.

1. **Sales never stop.** 100% of attempted sales at a pilot outlet complete during an internet outage; the cashier sees no difference other than a status icon.
2. **Fast at the counter.** Median takeaway order (2 items, cash) from “new order” to receipt printing in ≤ 20 seconds; adding a menu item with one modifier on mobile in ≤ 3 taps.
3. **Money is exactly right.** Zero duplicate payments or duplicate orders under retry, double-tap and reconnection testing; every receipt total equals the ledger total; the monthly PBJT export reconciles to receipts to the rupiah.
4. **One outlet, one truth.** Order created on a waiter phone is visible on the desktop and the kitchen display within 1 second on LAN; cloud lag p95 ≤ 60 seconds when online; zero silent data loss (every conflict is recorded and visible).
5. **Configurable by the owner.** An owner sets tax, service charge, rounding, price mode, payment methods and roles without vendor assistance; a change of PBJT rate is done with an effective date and does not rewrite history.
6. **Sellable in two shapes.** Standalone package installs and runs with no cloud account; upgrading to Cloud later keeps all history.

## 3. Non-goals (v1) and known ceilings

Non-goals, with rationale:

- **Customer self-order (QR at table / kiosk) and online ordering for customers.** Separate product surface with its own payment flow; ships after the staff-facing loop is solid (P2, phase 8).
- **Native delivery-platform integration (GoFood, GrabFood, ShopeeFood) at launch.** Requires partner API onboarding with external lead time; v1 records delivery orders manually with a per-channel price book (P2 for API adapters).
- **Accounting, payroll, HR/attendance beyond shift clock.** Shift and cash management are in scope; payroll, BPJS, leave, face-recognition attendance are not. Accounting is an export (CSV) first, connector later.
- **Card terminal (EDC) integration (ECR).** Standalone EDC with manual reference entry is the dominant Indonesian practice; ECR is bank-specific and a P2 adapter.
- **Payment gateway integration (dynamic QRIS, e-wallet APIs).** Decided 2026-09-30: no gateway contract. QRIS is the outlet’s static QR with cashier confirmation and an optional transaction reference; MDR is a reporting figure only. Revisit only if customers demand auto-confirmation.
- **Hotel-restaurant specifics.** Decided 2026-09-30: no hotel customers targeted, so the Permenaker 7/2016 service-charge distribution report and any PMS integration are out.
- **e-Faktur / Coretax integration.** PKP receipt fields are supported in data and print; filing integration is P2 and only matters to PKP customers.
- **Multi-currency, franchise royalty accounting, AI forecasting.** Not the target segment for v1.
- **A fourth “KDS app”.** Kitchen display is a mode of the mobile app (tablet) and a window of the desktop app; a separate app is not built.

Known ceilings (deliberate v1 simplifications, recorded so they are not “fixed” by accident):

- **One desktop per outlet is the authority.** A second desktop cashier terminal joins as a LAN client (P1). Automatic failover of the authority role is not in v1; recovery is restore-from-backup.
- **Catalogue has one editor at a time.** In the Cloud package the backoffice owns menu/settings and the desktop gets a small set of operational edits (sold-out, table status, quick price if permitted). Two-way free-form catalogue merge is not attempted.
- **Mobile never syncs to the cloud.** Single sync path (mobile → desktop → cloud) by design; a mobile device without a reachable desktop cannot take orders.
- **Offline card payments are not “stored and forwarded”.** Card and QRIS tenders are recorded as confirmed-by-cashier facts (reference number), not authorised by the POS; there is nothing to forward. QRIS is static only (no gateway, decision D14).
- **Reports on the cloud are eventually consistent** and say so (“data s/d HH:MM”).

## 4. Market context

Sources: official pricing pages and help centres of Moka, Majoo, ESB, Pawoon, Olsera, iSeller, Qasir, Kasir Pintar, Nutapos, Loyverse, iReap, Runchise, Youtap; help centres of Toast, Square for Restaurants, Lightspeed K-Series, TouchBistro, Revel, Oracle MICROS Simphony, Clover, Odoo (URLs in Appendix D). Snapshot September 2026.

### 4.1 Indonesian competitors, condensed

| Vendor | Cashier platform | Waiter app | KDS | Tables | Reservations | Recipes / auto-deduct | Offline model | Price (per outlet / month, published) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Moka (GoTo) | Android, iOS | Partial (second POS device) | not found | Pro+ | no | yes | per-device store-and-forward; device-to-device “Offline Sync” on Pro+; no e-payments or GoFood offline | Rp 299k / 499k / 799k; +Rp 10k per extra employee slot |
| Majoo | Android, iOS, Windows, macOS, web | Partial (“Mode Meja”) | Prime tier | Advance tier | ? | yes | **Local Server**: master device + LAN clients; full cloud sync capped at 5×/day | Rp 249k / 499k / 999k; add-ons ≈ Rp 499k each |
| ESB | web (Win, Linux, iOS, Android) | yes | ESB Kitchen | Advanced+ | partial | yes (ESB Core) | device auto-sync, mechanism undocumented | Basic Rp 0* / Advanced Rp 499k / Enterprise quote |
| Pawoon | Android, iOS | yes (Pawoon Order, 3.1★) | ? | yes | ? | yes | per-device | Free (7 trx/day) / Pro Rp 299k |
| Olsera | Android, Windows (iOS Premium+) | yes, all tiers | yes, all tiers | yes | yes | yes | per-device; owner can disable offline | Rp 1.288M / 1.988M / 2.688M per year |
| iSeller | iOS, Android, web | yes | external KDS | yes | ? | ? | “SmartSync”, carts shared across registers | Rp 250k / 450k / 950k / 1.85M |
| Qasir | Android | no | no | notes only (Pro Plus) | no | Pro | per-device; **unsynced data lost on logout** | Free / Rp 66.780 |
| Kasir Pintar | Android, iOS, Windows | partial | no | Pro | no | plugin | **Windows LAN server** + clients; cloud sync manual | Free / Pro from Rp 55.500 + plugins |
| Nutapos | Android, web | partial | add-on Rp 99k | add-on Rp 50k | yes, with deposits | yes | per-device | Rp 125k–250k, or Rp 200 per receipt |
| Loyverse | Android, iOS | partial (cloud open tickets) | free, LAN | no floor plan | no | composite items | per-device; refunds and customer edits disabled offline | Free; $25 add-ons |
| Runchise | Android, iOS, Windows | yes | per-station | yes | ? | cloud-side | LAN fallback, UUID de-duplication | ≈ Rp 250k (third-party) |

### 4.2 Table stakes (must match)

Android cashier app + cloud back office; QRIS and e-wallet acceptance; percentage tax, service charge and cash rounding; variants and modifiers; manual discounts; digital receipts; real-time sales dashboard; staff accounts with permissions, attendance and shift/cash close; ingredient recipes with automatic deduction; kitchen printing over Bluetooth or LAN with kitchen/bar split; multi-outlet reporting; 14-day trial; WhatsApp support.

### 4.3 Differentiators worth adopting

- **A real local server** (Majoo Local Server, Kasir Pintar LAN server, TouchBistro Mac mini, Revel main station, MICROS CAPS): one device is the authority for the outlet, arbitrates check ownership, and replays its queue before declaring itself online. This is exactly the desktop-as-server design in this PRD; the market’s weak point (manual or throttled cloud sync) is what to beat.
- **Documented offline behaviour** (Loyverse, Toast): say precisely what works and what does not when disconnected.
- **UUID idempotency for de-duplication** (Runchise) and **cash vs non-cash rounding, service charge taxable toggle** (Majoo).
- **Rounding simulator before applying** (Olsera); **dynamic QR generated from the open bill** (ESB, not adopted: no gateway, D14); **save-vs-publish for menu changes** and **per-user permission overrides** (Toast); **blind cash close, over/short thresholds needing a manager** (Toast); **fallback printer per printing profile** (Lightspeed).
- **Pricing by business size, not by gating F&B basics** (iSeller); **unlimited staff per outlet** (Runchise, ESB).

### 4.4 Complaints to design against

| Complaint (source type) | Design response in this PRD |
| --- | --- |
| Terminal and dashboard out of sync for hours; transactions lost; stock discrepancies (Play Store reviews, consumer letters) | Continuous outbox sync, idempotent by id, conflicts surfaced never dropped; cloud reports state their freshness (§9.20) |
| Offline is single-device; unsynced sales lost on logout (help centres) | Desktop authority on LAN; sign-out and uninstall blocked while unsynced; nightly local backup (§9.20) |
| Core F&B features locked in top tiers; per-terminal and per-employee fees (pricing pages) | Two packages only; tables, KDS, waiter app, recipes in both; no per-employee seats (§0, open question Q1) |
| No after-hours support (reviews) | Out of PRD scope; flagged for the business plan |
| Delivery orders arrive late in POS (reviews) | Delivery integration is P2 and must be webhook-driven with visible per-order latency, not polling |

## 5. Indonesian regulatory and payment context

Facts that shape requirements. Every value below is a **range the product must support**, never a constant.

| Topic | Rule (source) | Range to support | Requirement |
| --- | --- | --- | --- |
| Restaurant tax **PBJT Makanan/Minuman** (ex-PB1) | UU 1/2022 HKPD: regional tax, ≤ 10%, rate set per kabupaten/kota Perda; base is the amount paid by the consumer; small sellers exempt below a **per-region** turnover threshold (Jakarta Rp 42 jt/month, Tangerang Rp 20 jt, Malang Rp 5 jt). Service charge is inside the base (Pergub DKI 35/2024 Ps. 8). If the bill does not show the tax, payment is **deemed tax-inclusive** (Pergub DKI 35/2024 Ps. 9). Monthly reporting. | 0–10% per outlet; label configurable (“PBJT”, “Pajak Restoran”, “PB1”); base = subtotal − discount + service charge (toggle) | Tax is outlet data with effective dates; a tax line always prints; monthly export by calendar month of transaction time |
| **PPN** (VAT) | Statutory 12% with DPP 11/12 → effective 11% on non-luxury goods (PMK 131/2024); restaurant F&B is **non-BKP** when it is a PBJT object, so PBJT and PPN never stack on a meal. A PKP restaurant still charges PPN on retail/packaged goods. PKP threshold Rp 4.8 bn/year. Retail PKP receipt = tax invoice if it shows seller name, address, NPWP, items, PPN, serial (PER-11/PJ/2025). | 0% or PPN per item tax class; PKP on/off; NPWP + serial on header | Per-item **tax class**; default F&B lines PBJT-only; PKP mode adds header fields and PPN line |
| **Service charge** | Permenaker 7/2016 (hotels and in-hotel restaurants): optional; if collected, 3% reserve / 2% HR / 95% to workers. Standalone restaurants: voluntary. Market 5–10%, up to 20%. Taxable under PBJT. | 0–20% per outlet; basis before/after discount; taxable flag; by order type | Service charge engine; distribution report not planned (no hotel clients, Q4) |
| **Price display** | Permendag 35/2013: prices in Rupiah; displayed price must state whether tax and charges are included; UU 8/1999 consumer right to correct price info. | Inclusive or exclusive per outlet; per-item override | Print the mode statement on menu and receipt |
| **Rounding** | Permendag 35/2013 Ps. 6: rounding allowed for fractions of non-circulating denominations, must be disclosed at payment. Coins in circulation: 100/200/500/1000. | Increment 0/50/100/500/1000; nearest/up/down; cash only or all tenders | Rounding is its own signed receipt line (“Pembulatan”), never folded into the tax base |
| **QRIS** | BI standard; static (customer types amount) vs dynamic (POS generates per-bill QR via a PJP/gateway). MDR borne by merchant, **surcharging prohibited**. MDR 2025: micro 0% ≤ Rp 500k; others 0.7%; from 1 Oct 2026 0% ≤ Rp 100k for small/medium/large. Gateways (Midtrans, Xendit, DOKU) ≈ 0.7%. | MDR by method × tier × threshold, effective-dated; for net-revenue reporting only | Static QRIS tender with manual confirmation and optional transaction reference (P0); dynamic QRIS not planned (no gateway, D14) |
| **Cards / EDC** | Dominant practice is a standalone bank EDC; cashier keys amount, records approval code, reference, last 4 digits in POS. ECR integration exists (BCA over LAN) but is bank-specific. Debit MDR 0.15–1%, credit 1.8–2.5%; surcharge prohibited. | Per-method required fields; per-acquirer MDR | Card tender captures acquirer, type, last4, approval code, reference (P0); ECR adapter P2 |
| **E-receipts** | WhatsApp receipts are standard; no rule requires paper; digital receipt must carry the same tax lines. WA Business Platform ≈ Rp 357–586/message; share-sheet is free. | Print / WhatsApp share / hosted link / email / none | Free share first; hosted link needs Cloud; API sending optional with cost cap |
| **Hardware** | ESC/POS thermal printers 58mm (Bluetooth/USB) and 80mm (USB/LAN 9100/Bluetooth); cash drawer via printer RJ11 kick; kitchen printers 80mm LAN with buzzer; Windows PCs where 2+ cashiers; Android tablets for waiters; wired LAN for printers and EDC, Wi-Fi for tablets. | 58/80mm; TCP, Bluetooth, USB; printer roles | Raw ESC/POS printing with role routing, fallback and offline print queue |
| **Delivery platforms** | GoFood 20% + Rp 1,000; GrabFood 25–30%; ShopeeFood ≈ 20%; official APIs: GoBiz Developer Portal, GrabFood Partner API (partner approval required). Delivery menus typically priced 25–43% above dine-in. Delivery orders remain PBJT objects. | Commission 0–35% per channel; per-channel price book | Order source + channel price books in v1; API adapters P2 |
| **Business day** | No regulation; tax period is the calendar month by transaction timestamp; industry closes by shift (“tutup kasir”). | Cut-off 00:00–06:00 per outlet | Store timestamps with zone; derive business date for operations; tax reports by calendar month |
| **Personal data (UU PDP 27/2022, PP 33/2026 effective 16 Jan 2027)** | Name and phone are personal data; consent must be purpose-specific and separate; data-subject requests and breach notices within 72 hours; fines up to 2% of revenue. | Consent purposes: receipt / loyalty / marketing; retention N months | Consent capture when a phone is saved; export/delete customer; phone masking on receipts; access log |

## 6. Product shape

### 6.1 Topology

```
   Waiter phones / tablets            Kitchen display tablet
   (Mobile app)                        (Mobile app, KDS mode)
        │  LAN / Wi-Fi (TLS, paired)          │
        └──────────────┬──────────────────────┘
                       ▼
        ┌──────────────────────────────┐        printers (LAN/USB/BT)
        │  DESKTOP  — outlet authority │──────► cash drawer (via printer)
        │  cashier UI + local DB       │        EDC (manual entry)
        │  + management module         │
        └──────────────┬───────────────┘
                       │  WAN, when available (outbox / change feed)
                       ▼
        ┌──────────────────────────────┐        ┌──────────────────┐
        │  CLOUD API + database        │◄──────►│  BACKOFFICE web  │
        │  (Cloud package only)        │        │  always online   │
        └──────────────────────────────┘        └──────────────────┘
```

### 6.2 Personas

| Persona (UI in Indonesian) | Device | Cares about |
| --- | --- | --- |
| Owner (Pemilik) | Backoffice; desktop management module in Standalone | Leakage control, tax correctness, multi-outlet view, cost |
| Outlet manager (Manajer outlet) | Desktop, mobile | Staff, approvals, day close, menu availability |
| Cashier (Kasir) | Desktop | Speed, change calculation, printing, shift balance |
| Waiter (Pelayan) | Mobile (phone or tablet) | Tables, fast item entry, kitchen status, reservations |
| Kitchen / bar (Dapur / Bar) | Tablet in KDS mode, kitchen printer | Clear tickets, timing, modifiers |
| Backoffice admin (Admin) | Backoffice | Menu, users, inventory, promotions, sync health |
| Accountant (Akuntan) | Backoffice exports | Monthly tax, payment reconciliation |
| Customer (Pelanggan) | Receipt, QRIS | Correct bill, clear tax lines, e-receipt |

### 6.3 Product decisions (opinionated, with rationale)

| # | Decision | Why |
| --- | --- | --- |
| D1 | The desktop is the single authority for an outlet. Mobile devices are LAN clients and never contact the cloud. | Every reliable offline POS names one local authority (TouchBistro, Revel, MICROS CAPS). One sync path = one place to reason about ordering and duplicates. |
| D2 | The Standalone package includes a management module inside the desktop (menu, staff, roles, settings, tables, reports, backup). | “Sold without backoffice” must still be a complete product. |
| D3 | Multi-outlet consolidation, central menu and remote reports are Cloud-only. Standalone multi-outlet means independent outlets. | Consolidation requires a shared server by definition. |
| D4 | Catalogue and configuration have exactly one editor: the cloud in the Cloud package (“managed mode”), the desktop in Standalone. The desktop keeps a short list of operational edits in managed mode. | Avoids two-way merge of mutable config, the source of most sync bugs. |
| D5 | Financial records are append-only. Voids, refunds, adjustments and reopenings are new rows carrying who, when, why and (if approved) the approver. | Audit trail is the product; also makes sync trivially conflict-free for money. |
| D6 | Money is integer rupiah; rates are basis points (10.00% = 1000); every rate is effective-dated. Sale-time values (name, price, tax rate, modifiers) are snapshotted onto the order line. | No float drift; history and reprints never change when the menu or tax changes. |
| D7 | Every mutation that moves money or creates an order carries a client-generated id and is idempotent. | Tablets retry on flaky Wi-Fi; a retry must be a no-op. |
| D8 | State transitions on shared objects (table, bill, ticket, shift) are guarded in the database and a lost race returns a conflict the client refetches. | Several devices edit the same table at once; last-write-wins on a bill is unacceptable. |
| D9 | Business day ≠ calendar day for operations; calendar month for tax. | Outlets trade past midnight; regional tax is filed by calendar month. |
| D10 | Kitchen display is a mode of the mobile app and a window of the desktop app, not a separate app. | Same LAN client, same auth, smaller surface. |
| D11 | Inventory deducts when an item is **sent to the kitchen** (default; configurable to “at payment”). | Food is consumed when cooked, not when paid; matches Toast’s quantity behaviour. |
| D12 | Manager override is done on the requesting device by entering the manager’s PIN; the record stores both the actor and the approver. | Speed at the counter, full audit. |
| D13 | **No licence enforcement.** Standalone runs on the honour system: the desktop creates its business and outlet locally with no activation key. The Cloud activation code is provisioning (binding a desktop to a cloud outlet), not licensing. | Decided 2026-09-30 (Q1). Removes a whole failure mode (locked-out outlets) and phase 0 work. |
| D14 | **No payment gateway.** QRIS is the outlet’s static QR; the cashier confirms after seeing the customer’s success screen and may be required to enter the transaction reference. Dynamic QRIS, e-wallet APIs and gateway refunds are unplanned. | Decided 2026-09-30 (Q3). No merchant-of-record or MDR pass-through complexity; settlement stays between outlet and its PJP. |
| D15 | **Windows first.** Desktop targets Windows (~90% of installs); macOS builds are best-effort and never release-blocking. | Decided 2026-09-30 (Q2). |

## 7. User stories

Ordered by priority within each persona. Edge cases included.

**Owner**
- As an owner, I want to set my outlet’s PBJT rate, service charge, rounding rule and inclusive/exclusive price mode myself, so receipts match my region’s Perda and my pricing policy without calling the vendor.
- As an owner, I want the outlet to keep selling with no internet at all, so an outage never costs me a sale.
- As an owner, I want to buy the desktop and mobile apps without a cloud subscription and upgrade later without losing history, so I pay for the cloud only when I open a second outlet.
- As an owner of several outlets, I want one menu with per-outlet price and availability overrides and one consolidated sales report, so I stop maintaining outlets by hand.
- As an owner, I want every void, discount, refund, price override and reopened bill listed with who did it and who approved it, so leakage is visible.
- As an owner, I want a monthly PBJT export per outlet by calendar month, so filing takes minutes.
- As an owner, I want to change a tax rate from a future date, so history and reprints stay exactly as sold.

**Outlet manager**
- As a manager, I want to create staff, assign a role per outlet, and grant or revoke a single permission for one person, so a trusted cashier can void without becoming a manager.
- As a manager, I want to approve a cashier’s void or discount by entering my PIN on their screen, so the queue keeps moving and the approval is recorded.
- As a manager, I want to close the business day with a cash count that shows expected vs counted and needs my approval when the variance exceeds a threshold, so shortages surface daily.
- As a manager, I want to mark an item sold out from any device and have it disappear from the waiter app instantly, so waiters stop taking orders the kitchen cannot fill.
- As a manager, I want to edit the floor plan (sections, tables, capacity) without a vendor, so a rearranged room is reflected the same day.
- As a manager, I want to see which devices are connected and what is waiting to sync, so I can tell a Wi-Fi problem from a data problem.

**Cashier**
- As a cashier, I want to ring a takeaway order and take cash with change computed in a few taps, so the queue moves.
- As a cashier, I want to print a bill for a table before payment and then take a payment split across cash and QRIS, so groups can pay how they like.
- As a cashier, I want to split a bill by items, by seat, evenly or by amount, so a group of six can settle separately.
- As a cashier, I want to record an EDC payment with the approval code and last four digits, so the shift reconciles to the bank settlement.
- As a cashier, I want to confirm a QRIS payment after seeing the customer’s success screen and record its transaction reference, so a fake screenshot is traceable at settlement and the queue keeps moving.
- As a cashier, I want to remove an unsent item freely but need a reason and approval for a sent one, so mistakes are cheap and theft is not.
- As a cashier, I want to open my shift with a float and record cash in/out with reasons, so the drawer reconciles.
- As a cashier, I want a reprint clearly marked as a copy, so duplicates cannot pass as originals.
- As a cashier, when the same payment is submitted twice because the app retried, I want exactly one payment recorded, so I never over-charge.

**Waiter**
- As a waiter, I want to log in once with username and password on the shared tablet and then unlock with my PIN at every shift change, so switching users takes two seconds.
- As a waiter, I want to see the floor plan with table status and open a table in one tap, so I know where to go.
- As a waiter, I want to add items with variants, modifiers and a free-text note and send them to the kitchen, so the order reaches the right station correctly.
- As a waiter, I want to be told when the kitchen marks my items ready, so food does not sit on the pass.
- As a waiter, I want to take a reservation with name, phone, pax, time and preferred table, and see today’s list, so walk-ins and bookings do not collide.
- As a waiter, when Wi-Fi blips, I want my order to queue and send when it reconnects, with a clear indicator, so I do not re-enter it or lose it.
- As a waiter, if the desktop is off, I want a clear message that says what to do, so I do not assume the order went through.

**Kitchen**
- As a cook, I want to see only my station’s items, oldest first, with modifiers and notes prominent, and bump them when done, so nothing is missed.
- As a cook, I want an all-day count of what is pending, so I can batch.
- As an expo, I want to see the whole ticket across stations and mark it served, so tables get complete courses.
- As a cook, if the display fails, I want tickets to fall back to the printer, so service continues.

**Backoffice admin**
- As an admin, I want to edit the menu centrally and publish it, with per-outlet price and availability overrides, so a price change hits 12 outlets at once.
- As an admin, I want to manage users and roles across outlets and see per-user overrides, so access is auditable.
- As an admin, I want to see each outlet’s last sync time, pending items and conflicts, so I catch problems before the owner does.
- As an admin, I want to receive purchases, count stock, record waste and transfer stock between outlets, so COGS is real.

**Accountant**
- As an accountant, I want sales, tax and service charge by payment method and by day, exportable to CSV, so I can reconcile QRIS and EDC settlements.
- As an accountant, I want refunds and voids with reasons and approvers in the export, so month-end review is fast.

**Customer**
- As a customer, I want a receipt that shows the tax line, the service charge line, any rounding, and whether prices include tax, so the bill is understandable.
- As a customer, I want the receipt sent to WhatsApp instead of paper, so I have a record.

## 8. Cross-cutting requirements (apply to every feature)

These are P0 and non-negotiable. They are the reason the product is trustworthy.

| Id | Requirement | Acceptance criteria |
| --- | --- | --- |
| X1 | **Integer money.** All amounts in integer rupiah. Rates in basis points. Division only at defined rounding steps. | No floating-point money type anywhere in storage or transport. Property test: for 10,000 random bills, sum of lines + service + tax + rounding = total. |
| X2 | **Defined bill math order** in one pure, tested function: line total → line discount → subtotal → bill discount → service charge → tax → rounding → total. Inclusive mode derives components from the total. | Worked examples in Appendix C reproduce to the rupiah. Per-line allocation uses largest-remainder so line sums equal bill sums. |
| X3 | **Append-only financial records.** Order lines once sent, payments, refunds, shifts and stock movements are never updated or deleted; corrections are new rows with actor, approver, timestamp, reason. Soft delete only for catalogue. | Database grants: no UPDATE/DELETE on ledger tables from the application role, except status columns guarded by transitions. |
| X4 | **Snapshot at sale.** Each order line stores item name, variant, modifiers, unit price, tax class, tax rate, service rate as sold. | Changing a menu price or tax rate after sale does not change any existing receipt or report. |
| X5 | **Idempotency.** Every create of order, line, payment, refund, void, shift movement, stock movement carries a client-generated UUID; repeat is a no-op returning the original. | Double-submit test yields exactly one row. |
| X6 | **Guarded transitions.** Table, order, ticket, shift and reservation state changes are conditional updates; a lost race returns a conflict error with a message that says what to do next, and the client refetches. | Two devices paying the same bill concurrently produce one payment and one conflict. |
| X7 | **Permission by name**, checked on the server (desktop or cloud), never only in UI. Effective permissions = role grants + user grants − user revokes. | Every mutating endpoint lists its permission; tests cover deny paths. |
| X8 | **Audit log** of every permission-gated action and every settings change: actor, approver, device, before/after, reason. | Audit is itself append-only and synced. |
| X9 | **Outlet scoping.** Every transactional and catalogue row carries `outlet_id`; every query is filtered by it; a user acts only on outlets they belong to (owner is global). | Cross-outlet access test returns “Outlet tidak ditemukan.” |
| X10 | **Business date** derived from outlet timezone and cut-off; order numbers reset per outlet per business date; tax exports by calendar month. | A sale at 01:30 with cut-off 04:00 belongs to the previous business date and to the calendar month of its timestamp. |
| X11 | **Dynamic settings.** Every commercial rule lives in the settings catalogue (Appendix B): typed, scoped (business → outlet → device), effective-dated for rates, validated, audited, synced. UI copy is Indonesian. | Adding a new tax component or payment method requires no code change. |
| X12 | **Errors say what to do next**, in Indonesian, and distinguish “you are not signed in” (session ends) from “you may not do this” (stay signed in, offer approval). | A permission refusal never signs the user out. |

## 9. Feature specifications

Tags: **P0** must-have for the phase where it first appears, **P1** fast follow, **P2** future. Apps: **D** desktop, **M** mobile, **B** backoffice. Package: **S** standalone, **C** cloud (blank = both).

### 9.1 Outlet, business and settings engine (D, B)

The settings engine is the backbone of “dynamic”. One typed catalogue (Appendix B) drives every rule.

- P0 Business (tenant) with legal name, NPWP, PKP flag, logo. One business has many outlets.
- P0 Outlet: name, address, phone, timezone, business-day cut-off, receipt header/footer, order-number prefix and reset rule, price mode statement text.
- P0 Settings catalogue with scopes: business default → outlet override → device override (printers, drawer, paper width). Each key has a type, validation, default, and a `permission` needed to edit it.
- P0 Effective-dated values for rates (tax, service, rounding, MDR): a change is scheduled from a date/time; the engine resolves the value in force at sale time; past values are retained.
- P0 Settings audit: who changed what, before/after, when, from which app.
- P0 In Standalone the desktop management module edits all settings. In Cloud, the backoffice edits business and outlet settings; the desktop edits only device-scoped settings and the operational list (D4).
- P1 Settings export/import (JSON) to clone an outlet.
- P1 “Simulate” panel: enter a sample bill and preview tax, service, rounding and receipt before saving (Olsera pattern).

Acceptance:
- Given a PBJT change from 10% to 8% effective tomorrow 00:00, when a bill closes today, then it uses 10%; when a bill closes tomorrow at 00:01, then 8%; reprinting today’s receipt shows 10%.
- Given no outlet override for `rounding.increment`, then the business default applies; given a device paper width of 58 mm, then only that device prints 58 mm.

### 9.2 Tax, service charge, rounding and price mode (D, M, B)

- P0 **Tax components**, many per outlet. Each: name, receipt label, rate (bp), inclusive or exclusive, base includes service charge (bool), applies to order types, applies to item tax classes, effective-from. Default catalogue ships with `PBJT` (10%, exclusive, base includes service) and `PPN` (11% effective; disabled for F&B classes).
- P0 **Item tax classes**: e.g. `makanan_minuman` (PBJT only), `retail_bkp` (PPN only), `bebas_pajak` (none). Item → class; category default; per-item override.
- P0 **Service charge**: rate (bp), applies to order types (default dine-in only), basis after or before discount, taxable (default true), effective-from, receipt label.
- P0 **Rounding**: increment (0/50/100/500/1000), mode (nearest/up/down), tenders (cash only / all), applied once on the final total, printed as a signed `Pembulatan` line, excluded from all tax bases, reported separately.
- P0 **Price mode** per outlet: exclusive (menu shows net, receipt adds service and tax) or inclusive (menu shows final; receipt back-computes components). Per-item inclusive override for mixed menus (P1).
- P0 **Discount base rules**: tax and service are computed after discounts (regional rule: base is the amount actually paid).
- P0 Receipt must always show each tax component line, service line, rounding line when non-zero, and the inclusive/exclusive statement (“Harga sudah termasuk pajak” / “Harga belum termasuk pajak & service”).
- P1 **PKP mode**: header shows NPWP, address, receipt serial; PPN line present on PPN classes; monthly aggregate export (digunggung) of PPN receipts.
- P1 **Tax exempt bill** (permission-gated, with reason) for institutional customers.
- P2 Multiple tax jurisdictions per business (outlets in different cities) — already supported by outlet-scoped components; this item is the backoffice UX for bulk-setting them.

Acceptance (see Appendix C for numbers):
- Exclusive: items Rp 100,000, bill discount 10%, service 5%, PBJT 10%, cash rounding nearest 500 → subtotal 100,000; discount −10,000; service 4,500; PBJT 9,450; rounding +50; total 104,000.
- Inclusive: one item at Rp 55,000 with service 5% and PBJT 10% inclusive → net 47,619; service 2,381; PBJT 5,000; total 55,000; components sum exactly to the total.
- Given rounding applies to cash only, when the tender is QRIS, then no rounding line appears and the total is 103,950.

### 9.3 Identity, sessions, profiles and PIN (D, M, B)

- P0 Users belong to a business; a user has a username, password (argon2), display name, optional 4–6 digit PIN, status. Users are outlet-scoped through membership with a role per outlet; the owner role is global.
- P0 **Desktop login**: username + password. Session bound to the outlet the desktop is registered to. Idle lock optional (setting).
- P0 **Mobile profiles**: first login on a device requires username + password and creates a **profile** on that device (name, avatar initial). Subsequent switches select a profile and enter the PIN. A profile exists only after a full password login; removing a profile requires the profile owner’s PIN or a manager. Profiles persist across app restarts and shift changes.
- P0 PIN policy: length 4–6 (setting), lockout after N wrong attempts for M minutes (setting), wrong PIN never ends the session of the currently signed-in user.
- P0 Mobile idle lock after N seconds returns to the profile screen (setting); the in-progress order is kept.
- P0 Device registration: each mobile device pairs with the desktop once (6-digit pairing code shown on desktop), gets a device record (name, type, last seen) and a device token; devices can be renamed and revoked from the desktop or backoffice.
- P0 **Manager override**: when an action needs a permission the current user lacks, the screen asks for an approver PIN; the approver must hold the permission at that outlet; both ids are stored on the resulting record.
- P1 Desktop quick user switch by PIN (same profile mechanism as mobile), for outlets with several cashiers on one terminal.
- P1 Backoffice login with username + password; optional TOTP for owner/admin (C).
- P2 Clock-in/out and attendance report tied to profile switch.

Acceptance:
- Given a fresh tablet, when a waiter chooses “Masuk dengan PIN”, then no profiles are offered until someone logs in with a password.
- Given user A is signed in and user B enters a wrong PIN, then A stays signed in and B sees “PIN salah”.
- Given a cashier without `order.void_sent_item` voids a sent item and a manager enters their PIN, then the void row stores cashier as actor and manager as approver.

### 9.4 Roles and permissions (D, B)

- P0 **Permission catalogue** as `domain.action` names (Appendix A). Checked server-side on every mutation.
- P0 **Base roles** shipped as data and editable (rename, clone, change grants, add custom roles): Owner (global, all), Outlet Manager, Supervisor, Cashier, Waiter, Kitchen, Backoffice Admin (C), Accountant (read-only reports and exports).
- P0 **Role per outlet**: a user may be Cashier at outlet A and Supervisor at outlet B.
- P0 **Per-user overrides**: grant or revoke individual permissions for one user at one outlet, with reason and expiry (optional). Effective permission = role grants + user grants − user revokes. Revoke wins over grant.
- P0 Approval thresholds as settings: e.g. discount above X% or Rp Y requires approval; cash variance above Rp Z requires approval.
- P0 Owner role cannot be scoped to an outlet or revoked from the last owner.
- P1 Role templates by outlet type (kafe, restoran, warung) to speed setup.
- P1 Effective-permissions viewer: “what can this person do here, and why” (which role, which override).
- P2 Time-boxed elevated access (“supervisor until 23:00”).

Acceptance:
- Given Waiter role lacks `order.discount_bill` and user W has a grant override at outlet A, when W applies a bill discount at A, then it succeeds; at outlet B it prompts for approval.
- Given a role edit removes `payment.refund`, then every user with that role loses it immediately on all devices after sync, and the change is audited.

### 9.5 Menu management (D management module in S; B in C; read on D/M)

- P0 Categories: name, sort order, colour/icon, visible on POS, kitchen station default, tax class default, per-outlet visibility (C).
- P0 Items: name, short name for tickets, SKU, description, image, base price, cost (optional), tax class, kitchen station, prep time, sold-out toggle (“habis”), active flag, visible per order type, per-outlet price and availability override (C).
- P0 Variants (one axis, e.g. size): each variant has its own price (absolute or delta) and optional SKU; “starting price” shown on POS.
- P0 Modifier groups: name, min/max selections, required flag, options with price delta; reusable across items; per-item override of defaults; option can be marked sold out.
- P0 Item notes: free text, plus quick-note chips per category (e.g. “tidak pedas”, “tanpa es”).
- P0 Open-price item (permission-gated) for off-menu sales.
- P0 Sold-out (86) from POS by anyone with `menu.stock_toggle`; propagates to all devices within 1 second; optional auto-reset at business-day start.
- P0 Search by name/SKU; barcode scan for retail items (P1).
- P1 Combos/bundles: fixed set with a bundle price and per-component kitchen routing; choice slots (“pilih 1 minuman”).
- P1 Price books: per order type and per channel (dine-in, takeaway, GoFood, GrabFood, ShopeeFood); channel price books drive delivery-order entry.
- P1 Availability schedules (dayparts): menu or category visible only within time windows/days (e.g. “Sarapan” until 11:00).
- P1 Save vs publish (C): edits accumulate as a draft; publish pushes to outlets; scheduled publish; publish history with rollback.
- P1 CSV import/export of items, variants, modifiers, prices.
- P2 Time-based prices (happy hour) as price schedules with priority.
- P2 Allergen/tag metadata, nutrition, multi-language names.

Acceptance:
- Given item “Kopi Susu” with variants Small/Large and modifier group “Gula” (max 1), when a waiter adds Large + Less sugar + note, then the order line stores the snapshot: name, variant, modifier, prices, tax class, station.
- Given “Nasi Goreng” is marked habis on the desktop, when a waiter opens the menu on mobile, then it appears greyed with “Habis” and cannot be added.

### 9.6 Order taking and order lifecycle (D, M)

- P0 **Order types** (configurable): dine-in (needs table), takeaway, delivery (needs channel + customer/driver info), self-pickup. Each type carries: service charge applies, which tax components apply, which price book, requires pax, requires customer. Defaults ship for Indonesia.
- P0 Order object: outlet, business date, sequential order number (assigned by the desktop), type, table(s), pax, waiter, cashier, customer (optional), status, source device, notes.
- P0 Status lifecycle: `open` → items `unsent`/`sent` → `billed` (bill printed) → `paid` → `closed`; `cancelled` (no sent items) or `voided` (sent items voided). Transitions guarded (X6).
- P0 Line operations: add, change qty, change modifiers (unsent only unless `order.edit_sent_item`), note, remove unsent, void sent (reason + permission), repeat line, seat number (P1), course (P1).
- P0 **Send to kitchen**: sends all unsent lines (or selected lines) as a ticket per station; prints or displays; marks lines sent; deducts stock if configured. Send is idempotent per line.
- P0 Quick-service flow on desktop: new order → add items → pay in one screen; order type defaults to takeaway; table optional.
- P0 Hold/park orders (takeaway queue) and recall; queue number printed on receipt (P1 display).
- P0 Order search: by number, table, waiter, status, customer phone, within business date or range.
- P0 Order-level and line-level notes print on tickets, not on receipts (unless configured).
- P1 Coursing: assign lines to courses; hold and fire per course; KDS shows course state.
- P1 Seats: assign lines to seats; split by seat; seat count from pax.
- P1 Transfer lines or whole order to another table; transfer order to another waiter (both permission-gated).
- P1 Merge orders (two tables to one bill) and unmerge before payment.
- P1 Reopen a closed bill (permission `order.reopen_closed`, reason, approver) creating an adjustment trail; only within the same business date by default (setting).
- P2 Order source “delivery platform” fed by integrations; driver name, platform order id, platform-collected payment.
- P2 Customer-facing order status board.

Acceptance:
- Given a waiter sends 3 lines, when the request is retried by the client, then exactly 3 lines are marked sent and exactly one ticket per station is printed.
- Given order 0042 is `paid`, when another device tries to add a line, then it receives a conflict “Pesanan sudah dibayar. Muat ulang.” and refetches.
- Given the outlet cut-off is 04:00, when the first order of the day is created at 09:00, then numbering restarts at 1 for that business date.

### 9.7 Table and floor management (D, M)

- P0 Floor sections (indoor, outdoor, smoking, lantai 2) with per-outlet layout.
- P0 Table: name/number, capacity, shape, position, section, active flag, QR slug (reserved for P2 self-order).
- P0 Floor plan editor on desktop (drag, resize, rotate, add/remove) with `table.manage_layout`; layout syncs to mobile.
- P0 Table status derived from data, not stored twice: available, occupied (open order), bill printed, reserved (upcoming reservation within window), needs cleaning (after payment, optional), inactive. Colour and elapsed time shown.
- P0 One open order per table by default; setting to allow multiple tabs per table (named tabs).
- P0 Open table from floor plan → order screen; pax prompt if required.
- P0 Real-time status across devices via the desktop (≤ 1 second on LAN).
- P1 Merge tables for a large party (physical join) and unmerge; merged group shows as one.
- P1 Transfer order to another table (guarded: target must be available).
- P1 Table timers and “late service” indicator (no send within N minutes).
- P1 Waitlist integration: seat from waitlist to a table (§9.14).
- P2 Per-table QR for self-order; occupancy heatmap report.

Acceptance:
- Given two waiters tap “Buka meja 5” simultaneously, then one gets the new order and the other is shown the same open order (no duplicate order).
- Given a table has a bill printed, when the cashier takes full payment, then status becomes “needs cleaning” if enabled, else available, on all devices.

### 9.8 Kitchen: printer routing and Kitchen Display System (D, M-KDS)

Kitchen printing (phase 2):
- P0 Kitchen stations (dapur, bar, dessert, …) each with a printer and optional KDS; items route by item station, falling back to category station.
- P0 Ticket content: order number, table, waiter, time, pax, order type, items with qty, variant, modifiers, notes; configurable large font for items; per-station ticket contains only its items; optional consolidated copy at the pass.
- P0 Ticket types: new, added items, void (prints “BATAL” with the line and reason), reprint (marked).
- P0 Printer fallback: each station has a backup printer; failed prints queue and retry; failures surface on the desktop with the ticket content so a paper ticket can be handwritten.
- P1 Consolidate identical items across a ticket; “tapas” one-ticket-per-item mode.

Kitchen Display System (phase 3), a mode of the mobile app on a tablet and a window on desktop:
- P0 Station view: tickets for the station in arrival order; item-level or ticket-level bump (setting); recall last N bumped; undo bump within 5 seconds.
- P0 Ticket card: elapsed time with warning/late colour thresholds (settings), table/order number, order type, waiter, items with modifiers and notes in high contrast, void indicator, rush flag.
- P0 Expo/pass view: whole order across stations with per-station readiness; mark served.
- P0 All-day view: aggregate pending quantities per item (fired vs held when coursing exists).
- P0 Ready notification to the waiter’s device that sent the order (and to the desktop); optional sound.
- P0 Offline: KDS works against the desktop over LAN with no internet; if the KDS device is unreachable, tickets print at the station’s printer automatically (setting: print always / print only when KDS offline).
- P1 Coursing display: held courses greyed; fire from POS or expo.
- P1 Serving-time analytics: time from send to bump per station, per hour (report).
- P2 Order-ready customer board; multiple KDS per station with shared bump state.

Acceptance:
- Given a ticket with items for bar and kitchen, then the bar tablet shows only bar items and the kitchen printer prints only kitchen items; the expo screen shows both.
- Given `kds.warn_seconds = 600`, when a ticket passes 10 minutes unbumped, then its card turns to the warning colour on every KDS device.
- Given the KDS tablet loses Wi-Fi, when a new ticket is sent, then the station printer prints it within 5 seconds.

### 9.9 Payments and tenders (D; M for viewing only in v1)

- P0 **Payment methods** are data: code, name, type (cash, card, qris, ewallet, transfer, voucher, other), enabled per outlet, required fields (reference no., approval code, last 4, acquirer), opens drawer, allowed order types, MDR (bp) and settlement days for reporting only (surcharging QRIS or cards is prohibited and not offered).
- P0 Cash: quick tender buttons (exact, 50k, 100k, custom), change computed, rounding applied per §9.2, drawer kick.
- P0 Static QRIS: shows the outlet’s static QR on screen/receipt, cashier confirms after seeing the success screen (“Konfirmasi pembayaran diterima”), stores confirmation time and cashier; optional required transaction reference (setting) so the shift can be reconciled against the PJP settlement report (§9.17). No gateway (D14).
- P0 EDC (card) manual: acquirer, card type, last 4, approval code, reference; validation of required fields.
- P0 E-wallet/transfer manual: reference required.
- P0 One payment per bill in phase 1; **split payment** (multiple tenders on one bill, remaining balance shown) is P0 in phase 2.
- P0 Payment is append-only; correcting a wrong tender before shift close is a `payment_void` (permission `payment.void_same_day`, reason) plus a new payment.
- P0 Idempotent by client payment id (X5). Over-tender only allowed for cash (change); other tenders must equal remaining balance.
- P0 Receipt prints automatically on full payment (setting), with payment lines, change, rounding.
- P1 **Split bill**: by items, by seat, evenly into N, by custom amount; each part becomes its own bill with its own receipt and proportional tax/service allocation (largest remainder). Cannot split fractional quantities or a modifier off its item.
- P1 **Refund** after shift close (permission `payment.refund`, reason, approver): full or partial by line; creates a refund row referencing the original payment; cash refunds only on a device with a drawer; refund appears in reports as negative sales with reason.
- P2 Dynamic QRIS via a payment gateway — unplanned (D14). If ever revisited: adapter interface, static fallback when offline, no surcharge.
- P1 Tips (optional, setting): recorded per payment, excluded from tax base, reported per waiter.
- P1 Deposit/prepayment (reservations, §9.14) applied to a bill as a tender of type `deposit`.
- P2 Customer tab / pay later (house account) with credit limit and statement.
- P2 EDC integration (ECR) adapter; gift cards/vouchers as stored value.
- P2 Payment-method surcharge for methods where legal (not QRIS/cards), disclosed on receipt.

Acceptance:
- Given a bill of Rp 103,950 and cash rounding nearest 500, when the cashier tenders Rp 110,000 cash, then rounding +50, total 104,000, change 6,000, drawer opens, receipt shows all four lines.
- Given a Rp 200,000 bill, when Rp 100,000 QRIS is confirmed and then Rp 100,000 cash is tendered, then the bill is `paid` with two payment rows and one receipt listing both.
- Given the same payment request id is sent twice within 10 seconds, then one payment row exists and both responses return it.

### 9.10 Receipts, printing and e-receipts (D, M)

- P0 ESC/POS raw printing to 58 mm and 80 mm printers over TCP 9100, USB and Bluetooth; printer roles (receipt, kitchen station, bill); per-device printer assignment; test print; drawer kick command.
- P0 Receipt template: logo, outlet header (name, address, phone), NPWP when PKP, order number, business date and time, cashier, waiter, table/order type, pax, lines (qty × name @ price = total, modifiers indented), discounts, subtotal, service line, each tax line, rounding line, total, payments and change, footer text, inclusive/exclusive statement, optional QRIS static image, optional “powered by”.
- P0 Bill (pre-payment) print marked “TAGIHAN / BELUM LUNAS”; receipt (post-payment) marked “LUNAS”; reprints marked “SALINAN” with reprint count.
- P0 Print queue with retry and visible failure; a failed receipt never blocks the payment from completing.
- P0 Receipt numbering unique per outlet (order number + business date suffices; serial required in PKP mode).
- P1 E-receipt via WhatsApp share (free share sheet) of a PDF/image from desktop or mobile.
- P1 Hosted e-receipt link (C) with QR on the paper receipt; digital receipt carries identical lines.
- P1 Email receipt (C).
- P2 WhatsApp Business API sending with per-outlet monthly cost cap; customer-facing display (second screen) showing lines and total.

Acceptance:
- Given a printer is offline, when a cash payment completes, then the payment is recorded, the receipt enters the queue, the cashier sees “Printer tidak terhubung, struk dalam antrean” and can reprint later marked as an original if never printed.

### 9.11 Shift and cash management, business-day close (D)

- P0 Shift model: per terminal (default) or per cashier (setting). Sales require an open shift (setting, default on).
- P0 Open shift with opening float; cash in (setoran) / cash out (pengeluaran) with reason and optional receipt photo (P1); “no sale” drawer open logged (permission `shift.no_sale`).
- P0 Close shift: system shows expected cash (float + cash sales − cash refunds + cash in − cash out); cashier counts by denomination (optional) and enters counted; variance computed; variance beyond threshold requires approver PIN; blind close mode hides expected until after entry (setting, permission `shift.close_blind` vs `shift.close_full`).
- P0 Shift report (X report mid-shift, Z on close): sales by order type, by payment method, tax and service collected, discounts, voids, refunds, cash movements, variance, per-cashier breakdown; printable and stored.
- P0 Business-day close: closes all shifts, blocks new orders until a new day opens (setting), auto-close at cut-off (setting), warns on open orders and unsynced items; day report.
- P1 Cash denomination counting UI; safe drop tracking.
- P1 Per-waiter tips payout (if tips enabled).
- P2 Multi-drawer per terminal.

Acceptance:
- Given float 500,000, cash sales 2,350,000, cash out 100,000, when the cashier enters counted 2,700,000, then variance is −50,000; if the threshold is 20,000, then an approver PIN is required and both are stored on the shift.

### 9.12 Discounts and promotions (D, M; B for management)

- P0 Manual line discount and bill discount: percentage or fixed amount, reason from a configurable list, permission-gated with approval thresholds; shown on receipt; excluded from tax base (X2).
- P0 Discount reasons and maximum percentage per role as settings.
- P0 Price override on a line (permission `order.price_override`, reason) stored as override amount with the original price kept.
- P1 Promotions engine (automatic): conditions (date range, days, time window, order type, outlet, items/categories, minimum purchase, customer membership), effects (percentage, fixed, buy-X-get-Y, bundle price), stacking rules (exclusive / stackable with manual), per-outlet applicability, usage limits; automatically applied and named on the receipt; manager can remove with reason.
- P1 Voucher codes (single-use / multi-use, value or percentage, expiry).
- P2 Member pricing tiers; scheduled campaigns; promo performance report.

Acceptance:
- Given Cashier role has max manual discount 10%, when a cashier enters 15%, then the screen requests approval and, once approved, stores actor and approver.
- Given promo “Beli 2 Kopi gratis 1” active 14:00–17:00 on dine-in, when a dine-in order at 15:00 has 3 coffees, then one is discounted 100% with the promo name on the line.

### 9.13 Voids, refunds, adjustments and audit (D; B for review)

- P0 Void unsent line: free, logged (actor, time) but no approval.
- P0 Void sent line: permission `order.void_sent_item`, reason list (salah input, pelanggan batal, komplain, …), approver if needed; kitchen receives a void ticket; stock reversal if deducted (setting: return to stock / waste).
- P0 Void whole order with sent items: permission `order.void_order`, reason; order status `voided`; lines retained.
- P0 Payment void same business day (`payment.void_same_day`).
- P1 Refund after day close (`payment.refund`): partial by line or amount; creates refund rows; reason; approver; receipt prints “PENGEMBALIAN”.
- P1 Reopen closed bill (`order.reopen_closed`): reason, approver; audit shows before/after totals; only within same business date unless `settings.reopen_cross_day`.
- P0 Audit log viewer on desktop (own outlet) and backoffice (all): filter by action, actor, approver, date; export CSV.
- P1 Leakage report: voids, discounts, refunds, price overrides, no-sale opens by employee and hour.

### 9.14 Reservations and waitlist (D, M; B read-only + settings)

- P0 Reservation: customer name, phone (with consent capture), pax, date, time, duration (default setting), preferred section/table(s), source (walk-in phone, WhatsApp, Instagram, website), notes, tags (birthday, VIP), created by.
- P0 Statuses: `booked` → `confirmed` → `seated` → `completed`; `cancelled`, `no_show`; transitions guarded; no-show after grace minutes (setting) can be set manually or suggested.
- P0 Table blocking: an assigned table shows as reserved in the window [time − lead, time + duration]; overlap detection warns on double booking; unassigned reservations show in a “belum ada meja” list.
- P0 Day view (timeline by table) and list view; today’s arrivals on the mobile home screen; seat from reservation opens the table with pax pre-filled and links the order.
- P0 Local-first: reservations live in the desktop DB, editable from desktop and mobile; sync to cloud in Cloud package.
- P1 Deposit: amount, method, recorded as a prepayment tender; applied on the linked bill; forfeited on no-show (permission, reason); refunded via §9.13.
- P1 Waitlist: name, phone, pax, quoted wait; statuses `waiting`, `notified`, `seated`, `left`; seat to table.
- P1 WhatsApp confirmation/reminder via free share (manual) with templated text; automatic sending via API is P2 (C).
- P2 Online booking page (C) with availability rules, capacity per slot, blackout dates; Google/Instagram “Reserve” links.
- P2 Reservation analytics: no-show rate, covers by hour.

Acceptance:
- Given table 7 is reserved 19:00–21:00 with 30-minute lead, when a waiter tries to open table 7 as a walk-in at 18:45, then a warning shows the reservation and requires confirmation.
- Given a reservation is seated, then its order is linked and the reservation report shows spend per reservation.

### 9.15 Customers and loyalty (D, M, B)

- P1 Customer master: name, phone (unique per business), email, birthday, notes, tags, consent flags per purpose (receipt, loyalty, marketing) with timestamp and channel; attach to order by phone search; purchase history.
- P1 Data subject actions: export and delete a customer within 72 hours (anonymise order links, keep financial rows).
- P1 Phone masking on receipts (08xx-xxxx-1234).
- P2 Loyalty: points per Rp spent (rules by outlet), redeem as tender or discount, tiers, birthday reward, balance on receipt.
- P2 Customer display / e-receipt opt-in at payment.

### 9.16 Inventory (B in C; D management module in S; deduction on D/M)

- P0 Units of measure with conversions (kg↔g, L↔ml, pcs, pack of N).
- P0 Ingredients (raw materials) and stock-tracked retail items per outlet: name, unit, current quantity, minimum level, cost (moving average), supplier (optional).
- P0 Recipes (bill of materials) per item, variant and modifier option with quantity and yield; a menu item may be “tracked as stock” directly (no recipe).
- P0 Automatic deduction at send (default) or at payment (setting); void returns to stock or records waste (setting); negative stock allowed or blocked (setting); sold-out auto-toggle when stock ≤ 0 (setting).
- P0 Stock movements ledger (append-only): sale, void return, purchase, waste, adjustment, transfer out/in, count correction; each with actor, reason, reference.
- P0 Stock in (purchase receipt) with quantities and costs; waste with reason; adjustment with reason and permission; low-stock alerts (badge and daily summary).
- P1 Stock count (opname): count sheet by category, blind count option, variance report, post as corrections with approval.
- P1 Suppliers and purchase orders: create, send (PDF/WhatsApp), receive partially, close; cost updates.
- P1 Transfers between outlets (C): request, ship, receive, in-transit state, variance.
- P1 Reports: stock card per ingredient, valuation, COGS by item and period, theoretical vs actual usage, waste by reason.
- P2 Production of semi-finished goods; batches and expiry; par levels and auto-PO suggestions.

Acceptance:
- Given “Es Kopi Susu” recipe uses 18 g kopi and 150 ml susu, when 2 are sent to the bar, then kopi decreases 36 g and susu 300 ml with movement rows referencing the order lines; when one is voided as “salah input” with return-to-stock, then half is reversed.

### 9.17 Reports (D for own outlet; B for all outlets)

- P0 Sales summary by business date range: gross, discounts, net, service, each tax, rounding, refunds, voids, total, order count, average bill, pax and per-cover (dine-in).
- P0 By item, category, hour, day of week, order type, payment method, employee (waiter and cashier), device.
- P0 Tax report: PBJT (and PPN) collected by **calendar month** with per-day detail; service charge collected; export CSV.
- P0 Shift and business-day reports (§9.11); voids/discounts/refunds log (§9.13).
- P0 Export CSV; PDF for shift/day reports.
- P1 Payment reconciliation by acquirer and QRIS PJP with settlement date, transaction references and MDR estimate.
- P1 Kitchen performance (send→bump time), table turnover, reservation summary, inventory reports (§9.16).
- P1 Cloud reports (B) show consolidated and per-outlet views with a freshness stamp (“data s/d 14:32, 3 outlet menunggu sinkronisasi”).
- P2 Scheduled WhatsApp/email daily summary (C); P&L-lite (sales − COGS − service payout).

### 9.18 Multi-outlet (C)

- P0 Outlets under one business, each with timezone, cut-off, tax components, service, rounding, payment methods, printers.
- P0 Users with a role per outlet; owner global; per-user overrides per outlet.
- P0 Central menu with per-outlet overrides (price, availability, station); “apply to all outlets” with preview.
- P0 Consolidated reports and per-outlet drill-down; outlet comparison.
- P1 Stock transfers between outlets; outlet groups (brand, region) for reporting and menu targeting.
- P2 Franchise view (read-only per franchisee).

### 9.19 Backoffice (B, Cloud package)

Always online; no offline cache-as-truth; a network failure is an error to show and retry.

- P0 Dashboard: today by outlet with freshness stamps; alerts (unsynced outlets, conflicts, low stock, high variance shifts).
- P0 Outlets, settings (§9.1–9.2), users, roles, overrides (§9.3–9.4), devices, menu with publish (§9.5), reports (§9.17), audit log (§9.13).
- P0 Sync monitor per outlet: last seen, last successful push/pull, pending count, conflicts with resolve actions (§9.20).
- P1 Inventory (§9.16), promotions (§9.12), customers (§9.15), reservations read-only calendar (§9.14).
- P1 Activation codes for binding a new outlet’s desktop to the cloud (provisioning only; no licence enforcement, D13).
- P2 Delivery and payment integration settings (§9.22); API keys for third parties.

### 9.20 Local-first operation and sync (D, M, cloud)

This section answers “sync between local and server” in full.

**Roles**
- Desktop is the outlet **authority**: single writer to the outlet database; assigns order numbers; validates permissions; owns printing; hosts the LAN API.
- Mobile devices are LAN **clients**: all reads and writes go to the desktop. A mobile device keeps a small ordered **write queue** for LAN blips, replayed with the original client ids; the desktop de-duplicates. The queue is bounded (setting, e.g. 50 operations / 15 minutes); beyond it the app stops accepting new writes and says so.
- Cloud is a **subscriber and catalogue publisher**: it receives outlet data and, in the Cloud package, publishes catalogue and configuration. It never creates transactional rows.
- Backoffice reads and writes only the cloud.

**Data classes and direction**

| Class | Examples | Origin | Mutability | Direction | Conflict policy |
| --- | --- | --- | --- | --- | --- |
| A. Transactional ledger | orders, order lines, order events, payments, refunds, voids, shifts, cash movements, stock movements, audit | outlet | append-only | up only | none possible (insert-if-absent by id) |
| B. Catalogue and configuration | menu, modifiers, price books, tax/service/rounding, payment methods, order types, tables/floor, stations, users, roles, overrides, settings, promotions | cloud (Cloud package) or desktop (Standalone) | mutable, versioned, soft-deleted | down (Cloud); none (Standalone) | one editor at a time (D4); desktop operational edits (sold-out, quick price, table status, device settings) are LWW by version with the loser stored in `sync_conflicts` |
| C. Operational state | open orders before close, table status, ticket status, reservations, waitlist | outlet | mutable, guarded transitions | up as events; cloud shows read-only live view | authority is the desktop; cloud never writes |

**Mechanism**
- Desktop keeps an **outbox**: every committed change appends an entry with a monotonically increasing sequence per outlet, entity type, id, operation, payload, and the local transaction time.
- **Push**: batches of outbox entries (bounded size) sent with `(outlet_id, from_seq, to_seq, idempotency_key)`; cloud applies transactionally, records `received_at` separately from `occurred_at`, and acknowledges a high-water mark. Immediate push on new entries, plus a periodic tick (setting, default 15 seconds), exponential backoff on failure.
- **Pull**: desktop requests the tenant **change feed** since its cursor for class B records (and user/role changes); applies in order; bumps versions; re-renders menus on connected mobiles.
- **Initial provisioning**: Cloud package — an activation code from the backoffice binds the desktop to an outlet, delivers credentials and the initial catalogue. Standalone — the desktop creates the business and outlet locally; no licence check (honour system, D13). **Upgrade Standalone → Cloud** performs a full initial push of local history so nothing is lost.
- **Full resync** (rebuild local catalogue from cloud) is a guarded manual action that never touches unpushed outbox entries.
- **Ordering and time**: transactional events order by desktop sequence; the desktop clock defines business dates; cloud flags clock skew > 5 minutes in the sync monitor.

**Guarantees and status**
- Sales never wait for the cloud. Nothing in the payment path performs a network call.
- Every device shows a sync/connection state: desktop (cloud: green synced / yellow pending N / red failing since HH:MM; LAN: connected devices), mobile (terminal connected / reconnecting / offline with queued N), backoffice (per outlet last seen, pending, conflicts).
- Sign-out of the last profile, device un-pairing, app uninstall prompts and “reset data” are blocked while unpushed entries exist (mobile → desktop, desktop → cloud) unless an owner overrides with a typed confirmation.
- Cloud reports carry a freshness stamp and list outlets with pending data.

**Failure modes**

| Failure | Behaviour |
| --- | --- |
| Internet down at outlet | Desktop and mobile unaffected; outbox grows; e-receipt links deferred; status yellow. |
| Desktop off or unreachable | Mobile shows “Terminal kasir tidak terhubung” with what to do; can view cached floor plan and menu read-only; queues nothing that requires a number (no new orders beyond the bounded queue); KDS falls back to printers only if printers are reachable from the desktop (they are not) — so KDS goes dark and the desktop, when back, replays tickets to printers. |
| LAN blip (seconds) | Mobile queues and replays; desktop de-duplicates; UI shows “mengirim…”. |
| Desktop disk failure | Restore from the most recent automatic backup (below) and, in Cloud, replay the change feed; unpushed entries since backup are lost and reported as a gap on the sync monitor. |
| Catalogue conflict (Cloud) | Cloud version wins; losing edit stored and shown in backoffice and desktop with “apply mine” / “keep cloud” actions; never silently dropped. |
| Duplicate submission | Idempotent ids make it a no-op; no user-visible error. |

**Backup and restore (Standalone especially)**
- P0 Automatic daily encrypted backup of the desktop database to a configurable folder or USB drive with retention (setting); integrity check; manual backup now; restore wizard that refuses to restore over newer unpushed data without explicit confirmation.
- P1 Optional encrypted off-site backup to the vendor’s storage for Standalone customers (billing decision, Q7).

**LAN security**
- TLS between mobile and desktop with a per-desktop certificate pinned during pairing; pairing via a 6-digit code displayed on the desktop; device tokens revocable; desktop discoverable via mDNS with a manual IP fallback.

**Multi-terminal (P1)**
- A second desktop joins as a LAN client with full cashier UI (payments, printing to its own printers, its own drawer and shift). The authority remains one desktop. Automatic failover is a known ceiling.

Acceptance:
- Given the internet is unplugged for 8 hours, then all sales complete, the outbox holds them, and after reconnection the cloud shows every order and payment exactly once with correct business dates.
- Given a waiter sends an order during a 20-second Wi-Fi drop, then the order appears on the desktop and KDS once reconnected with a single order number and no duplicate ticket.
- Given the backoffice changes an item price while the desktop is offline and a manager quick-edits the same price locally, then after sync the cloud price applies and the local edit is listed as a conflict.

### 9.21 Devices and hardware (D, M)

- P0 Desktop on Windows (primary target, ~90% of installs, D15); macOS builds best-effort and not release-blocking; touch-friendly layout; 1366×768 minimum; keyboard shortcuts for cashiers.
- P0 Mobile on Android phones and tablets (primary), iOS (secondary); tablet layout for KDS and floor plan.
- P0 Printers as in §9.10; cash drawer via printer kick; barcode scanner as keyboard wedge (P1).
- P1 Second display as customer display (desktop).
- P2 Android POS all-in-one (Sunmi/iMin) build of the cashier app; integrated printers.

### 9.22 Integrations (P2 unless noted)

- P2 Payment gateway (dynamic QRIS) — unplanned (D14).
- P2 Delivery platforms: GoBiz (GoFood) and GrabFood Partner API adapters — order webhook → order with source, channel price book, platform-collected payment tender; accept/reject, mark ready; menu sync from the channel price book; store pause. Per-order latency visible. ShopeeFood via aggregator when available.
- P2 Accounting: CSV journal export (sales, tax, service, payments by method, refunds) first; Jurnal/Accurate connectors later.
- P2 e-Faktur/Coretax retail aggregate export for PKP customers.
- P2 EDC ECR adapter (BCA first).
- P2 Public API and webhooks for third parties (C).

### 9.23 Data protection (all apps)

- P0 Passwords argon2; PINs hashed; device tokens revocable; TLS everywhere; audit of access to customer data (P1).
- P1 Consent capture and purpose flags; retention setting; export/delete customer; phone masking on receipts; privacy notice text configurable.
- P1 Cloud data residency choice (Indonesia region) and breach-notification runbook (72 hours).

## 10. Requirements summary by priority

| Feature | P0 | P1 | P2 | Phase | Apps | Pkg |
| --- | --- | --- | --- | --- | --- | --- |
| Settings engine, outlet, effective-dated rates | core | export/import, simulator | — | 0 | D B | |
| Tax components, service, rounding, price mode | core | PKP mode, tax-exempt bill | SC distribution report | 1 | D M B | |
| Auth, mobile profiles + PIN, pairing, manager override | core | desktop PIN switch, TOTP | attendance | 0 | D M B | |
| Roles, permissions, per-user overrides | core | templates, effective viewer | time-boxed access | 0 | D B | |
| Menu: categories, items, variants, modifiers, 86 | core | combos, price books, dayparts, publish, CSV | happy hour, allergens | 1 | D M B | |
| Orders: types, lifecycle, send, hold/recall, search | core | coursing, seats, transfer, merge, reopen | platform source | 1–2 | D M | |
| Tables and floor plan | core | merge, transfer, timers, waitlist seat | QR self-order | 2 | D M | |
| Kitchen printing and routing | core | consolidation modes | — | 2 | D | |
| Kitchen Display System | core | coursing, analytics | customer board | 3 | M D | |
| Payments: cash, static QRIS, EDC manual, split payment | core | split bill, refunds, tips, deposits | tabs, ECR, gift cards, dynamic QRIS (unplanned) | 1–2, 5 | D | |
| Receipts and printing | core | WhatsApp share, hosted link, email | WA API, customer display | 1 | D M | link: C |
| Shift, cash, day close | core | denominations, tips payout | multi-drawer | 1 | D | |
| Discounts, price override | core | promotions engine, vouchers | member pricing | 1, 7 | D M B | |
| Voids, refunds, audit | core | reopen, leakage report | — | 1–2 | D B | |
| Reservations and waitlist | core | deposit, waitlist, WA templates | online booking | 5 | D M B | |
| Customers and loyalty | — | master, consent, DSAR | points, tiers | 7 | D M B | |
| Inventory | core | opname, PO, transfers, reports | production, expiry | 6 | B D | transfers: C |
| Reports | core | reconciliation, kitchen, consolidated | scheduled, P&L-lite | 1, 4 | D B | |
| Multi-outlet | core | transfers, groups | franchise | 4 | B | C |
| Backoffice | core | inventory, promos, activation | integrations | 4 | B | C |
| Sync engine, status, backup | core | off-site backup, multi-terminal | failover | 0 (model), 4 (cloud) | D M | cloud: C |
| Integrations | — | — | delivery, accounting, e-Faktur, ECR | 8 | D B | |

## 11. Development order

Phases are sequential deliverables; each has an exit criterion a pilot outlet can verify. The sync-ready data model (ids, outbox, versions, snapshots) is built in phase 0 even though the cloud arrives in phase 4, because retrofitting it is the most expensive change in a POS.

| Phase | Name | Scope | Exit criterion | Package milestone |
| --- | --- | --- | --- | --- |
| 0 | **Foundation** | Business/outlet model; settings engine with effective dates; users, roles, permission catalogue, per-user overrides; desktop login; mobile password login → profile → PIN; device pairing and LAN API (mDNS, TLS); manager override PIN flow; audit log; outbox and versioning in the schema; ESC/POS driver and printer roles; app shells with Indonesian copy. | A manager creates staff on the desktop, a waiter logs in on a tablet and switches by PIN, a settings change is audited, a test receipt prints. | — |
| 1 | **Counter sales** | Menu management (desktop module); quick-service ordering on desktop; bill math engine (tax components, service, rounding, inclusive/exclusive) with property tests; order numbering by business date; cash, static QRIS, EDC manual tenders; receipt and bill printing; manual discounts and price override with approvals; void unsent/sent items with reasons; shift open/close, cash in/out, X/Z reports; day close; sales and tax reports on desktop; daily local backup. | A warung or café runs a full day on one desktop with no internet, closes the shift with variance, exports the day. | **Standalone (counter)** pilotable |
| 2 | **Dine-in, waiter app, kitchen printing** | Floor sections and plan editor; table status; open bill per table; mobile ordering with variants/modifiers/notes; send to kitchen; kitchen station routing to printers with fallback; bill print; split payment; split bill; merge/transfer; pax; order types with per-type tax/service; mobile write queue; connection state UI; refunds and same-day payment void. | A full-service restaurant runs lunch with 3 waiters, 2 stations and 1 cashier; two devices editing one table never duplicate. | **Standalone (full-service)** pilotable |
| 3 | **Kitchen Display System** | Station and expo views; item/ticket bump, recall, undo; timers and colours; all-day view; ready notifications; printer fallback when KDS offline; KDS settings. | Kitchen works without paper for a full service; fallback verified by pulling the tablet off Wi-Fi. | **Standalone sellable** |
| 4 | **Cloud sync and Backoffice v1** | Cloud tenant and outlet activation; outbox push, change-feed pull, conflicts table; managed mode for catalogue; backoffice: dashboard with freshness, outlets, settings, users/roles/overrides, devices, menu with per-outlet overrides and publish, reports (consolidated + drill-down), audit, sync monitor; Standalone→Cloud upgrade path (initial full push); multi-outlet users. | Two outlets report into one backoffice; an 8-hour internet cut produces zero loss and zero duplicates; a price published centrally reaches both desktops. | **Cloud sellable** |
| 5 | **Reservations, waitlist, payment breadth** | Reservations (desktop + mobile), table blocking, day view, statuses, deposits as tenders, waitlist and seating, WhatsApp templates (manual); WhatsApp receipt share; hosted e-receipt link (C); tips; payment reconciliation report with QRIS references. | Reservations block tables on the floor plan; a deposit taken at booking settles against the bill; a shift’s QRIS payments reconcile to the PJP settlement report by reference. | |
| 6 | **Inventory** | Units, ingredients, recipes, deduction at send/payment, movements ledger, stock in, waste, adjustments, low stock; opname; suppliers and PO; transfers (C); stock and COGS reports; sold-out auto-toggle. | Theoretical vs actual variance report reconciles a week of counts. | |
| 7 | **Customers, loyalty, promotions** | Customer master with consent and DSAR; attach to order; promotions engine (automatic, conditions, stacking); vouchers; loyalty points; member pricing; leakage and promo reports. | An automatic promo applies correctly across two outlets; a customer export/delete completes. | |
| 8 | **Integrations and self-order** | GoFood/GrabFood adapters; ShopeeFood via aggregator; accounting CSV then connectors; e-Faktur aggregate export; ECR adapter; customer display; QR self-order and online booking; public API. | A delivery order lands in the POS within 10 seconds of platform acceptance with the channel price book. | |

Why this order:
- Phases 0–1 put money correctness (X1–X6) under test before any concurrency arrives.
- Phase 2 before 3: paper tickets are the fallback the KDS depends on.
- Phase 4 before reservations and inventory: the sync engine is the riskiest component and the market’s loudest complaint; it needs production hours early, and the Cloud package unlocks multi-outlet revenue.
- Inventory (6) after cloud (4) because PO, suppliers and transfers are backoffice work in most operations; deduction hooks already exist from phase 2.
- Integrations last because they depend on external partner onboarding (start commercial onboarding during phase 4).

## 12. Success metrics

Leading (measured at pilot outlets from phase 1):

| Metric | Target | Stretch | Method |
| --- | --- | --- | --- |
| Sales completed during internet outage | 100% | — | Chaos test per release + pilot logs |
| Duplicate orders/payments | 0 | 0 | Retry/double-tap test suite; pilot ledger scan |
| Takeaway order to receipt (2 items, cash) | median ≤ 20 s | ≤ 12 s | Timestamp from order create to print job |
| Mobile → desktop → KDS propagation on LAN | p95 ≤ 1 s | ≤ 500 ms | Event timestamps |
| Desktop → cloud lag when online | p95 ≤ 60 s | ≤ 15 s | `received_at − occurred_at` |
| Receipt total ≠ ledger total | 0 | 0 | Nightly reconciliation job |
| Shift closes with unexplained variance flag | tracked, not targeted | — | Shift table |
| Owner completes tax/service/rounding setup unaided | ≥ 90% of pilots | — | Onboarding checklist |
| Kitchen ticket send→bump | baseline then −20% | — | KDS events |
| Waiter app profile switch | ≤ 2 s | — | UI timing |

Lagging (30–180 days after launch):

| Metric | Target |
| --- | --- |
| Pilot outlets → paying outlets | ≥ 70% conversion |
| Data-loss incidents per outlet-month | 0 |
| Support tickets per outlet-month | ≤ 1 after month 2 |
| Standalone → Cloud upgrades | ≥ 30% of Standalone customers within 12 months |
| Outlets per Cloud business | ≥ 2.5 average |
| Monthly churn | ≤ 2% |
| NPS (owners) | ≥ 40 |

## 13. Open questions

Decided 2026-09-30 (were blocking):

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Standalone licensing | **Honour system.** No activation key or licence check in Standalone; the Cloud activation code is provisioning only (D13). |
| Q2 | Desktop platform | **Windows first** (~90% of installs); macOS best-effort, not release-blocking (D15). |
| Q3 | Payment gateway | **None.** QRIS static with cashier confirmation and optional transaction reference; dynamic QRIS unplanned (D14). |
| Q4 | Hotel-restaurant customers | **Not a target.** Service-charge distribution report and PMS integration dropped. |

Non-blocking (resolve during implementation):

| # | Question | Owner |
| --- | --- | --- |
| Q5 | Default stock deduction at send vs at payment (PRD proposes send). | Product |
| Q6 | Should mobile take payments in small outlets without a cashier (mobile-as-cashier), or stay waiter-only in v1? PRD keeps payments on desktop. | Product |
| Q7 | Off-site backup for Standalone customers: bundled, paid add-on, or not offered? | Business |
| Q8 | Cloud data residency: Indonesian region mandatory for UU PDP comfort? | Legal |
| Q9 | Will early customers be PKP (need NPWP/serial receipts and PPN on retail items in phase 1 rather than phase 2)? | Sales |
| Q10 | Per-outlet flat pricing with unlimited staff and devices (as positioned) vs device caps. | Business |
| Q11 | Partner API access timelines for GoBiz and GrabFood; aggregator for ShopeeFood. | Business |
| Q12 | Retention period for customer personal data and audit logs. | Legal |

## 14. Timeline considerations

- No external hard deadline is known. One regulatory date matters: **PP 33/2026 (UU PDP implementing regulation) is effective 16 January 2027**; customer-data features (phase 7) must ship with consent and DSAR handling, and cloud data residency (Q8) should be decided before phase 4 goes live.
- **QRIS MDR changes on 1 October 2026** (0% ≤ Rp 100k for small/medium/large merchants) — only affects net-revenue reporting; rates are effective-dated data.
- Partner onboarding (GoBiz, GrabFood) takes weeks to months; start during phase 4 so phase 8 adapters are not blocked.
- Dependencies: phase 2 depends on phase 1’s bill engine; phase 3 on phase 2’s routing; phases 5–8 on phase 4 for anything marked C.
- Pilot plan: one café (phase 1), one full-service restaurant (phase 2–3), one two-outlet operator (phase 4).

## 15. Glossary (Indonesian terms used in UI and reports)

| Term | Meaning |
| --- | --- |
| PBJT / PB1 / Pajak Restoran | Regional tax on food and beverages served by restaurants (≤ 10%, set per city/regency) |
| PPN | National VAT (effective 11%); not charged on restaurant F&B that is a PBJT object |
| PKP | Pengusaha Kena Pajak, VAT-registered business (turnover > Rp 4.8 bn) |
| NPWP | Tax identification number |
| Service / biaya layanan | Service charge |
| Pembulatan | Rounding line on the receipt |
| Harga sudah/belum termasuk pajak | Price includes / excludes tax (Permendag 35/2013 statement) |
| QRIS | National QR payment standard (statis / dinamis) |
| EDC | Bank card terminal |
| Tutup kasir / tutup shift | Shift close with cash count |
| Habis | Sold out (86) |
| Meja / denah meja | Table / floor plan |
| Struk / tagihan | Receipt / bill |
| Uang muka | Deposit / prepayment |
| Opname | Physical stock count |

---

## Appendix A — Base roles and permission catalogue

Permissions are `domain.action` names; ✓ = granted by default; all roles editable. Owner has all permissions globally. Backoffice Admin exists in the Cloud package only. Accountant is read-only.

| Permission | Manager | Supervisor | Cashier | Waiter | Kitchen | BO Admin | Accountant |
| --- | --- | --- | --- | --- | --- | --- | --- |
| order.create | ✓ | ✓ | ✓ | ✓ | | | |
| order.view_others | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| order.edit_sent_item | ✓ | ✓ | | | | | |
| order.void_sent_item | ✓ | ✓ | | | | | |
| order.void_order | ✓ | ✓ | | | | | |
| order.discount_item / order.discount_bill (≤ role max) | ✓ | ✓ | ✓ (≤ 10%) | | | | |
| order.price_override | ✓ | ✓ | | | | | |
| order.open_item | ✓ | ✓ | ✓ | | | | |
| order.change_table / order.change_server | ✓ | ✓ | ✓ | ✓ (own) | | | |
| order.split / order.merge | ✓ | ✓ | ✓ | | | | |
| order.reopen_closed | ✓ | | | | | | |
| order.tax_exempt | ✓ | | | | | | |
| payment.cash / payment.noncash / payment.split | ✓ | ✓ | ✓ | | | | |
| payment.void_same_day | ✓ | ✓ | | | | | |
| payment.refund | ✓ | | | | | | |
| payment.refund_unlinked | ✓ | | | | | | |
| shift.open / shift.cash_in_out | ✓ | ✓ | ✓ | | | | |
| shift.close_blind | ✓ | ✓ | ✓ | | | | |
| shift.close_full | ✓ | ✓ | | | | | |
| shift.no_sale | ✓ | ✓ | | | | | |
| shift.variance_approve | ✓ | ✓ | | | | | |
| shift.close_business_day | ✓ | | | | | | |
| kitchen.kds_use / kitchen.reprint_ticket | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| table.operate | ✓ | ✓ | ✓ | ✓ | | | |
| table.manage_layout | ✓ | | | | | ✓ | |
| reservation.manage | ✓ | ✓ | ✓ | ✓ | | | |
| reservation.deposit | ✓ | ✓ | ✓ | | | | |
| menu.stock_toggle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| menu.quick_edit_price | ✓ | | | | | ✓ | |
| menu.manage | ✓ (S) | | | | | ✓ | |
| inventory.view | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| inventory.receive / inventory.waste | ✓ | ✓ | | | ✓ | ✓ | |
| inventory.adjust / inventory.count | ✓ | | | | | ✓ | |
| inventory.transfer / inventory.purchase_order | ✓ | | | | | ✓ | |
| customer.manage | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| customer.export | ✓ | | | | | ✓ | ✓ |
| promo.manage | ✓ (S) | | | | | ✓ | |
| report.view_shift | ✓ | ✓ | ✓ (own) | | | ✓ | ✓ |
| report.view_outlet | ✓ | ✓ | | | | ✓ | ✓ |
| report.view_all_outlets | | | | | | ✓ | ✓ |
| report.export | ✓ | | | | | ✓ | ✓ |
| staff.manage / role.manage | ✓ (outlet) | | | | | ✓ | |
| staff.override_permissions | ✓ (outlet) | | | | | ✓ | |
| settings.manage_outlet / settings.manage_tax | ✓ (S) | | | | | ✓ | |
| settings.manage_business | | | | | | ✓ | |
| device.manage / printer.manage | ✓ | ✓ | | | | ✓ | |
| sync.view | ✓ | ✓ | ✓ | | | ✓ | |
| sync.force_resync | ✓ | | | | | ✓ | |
| audit.view | ✓ | | | | | ✓ | ✓ |

## Appendix B — Settings catalogue (initial)

Scope: **B** business, **O** outlet, **D** device. Effective-dated keys marked ⏱.

| Key | Scope | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| business.legal_name, business.npwp, business.pkp | B | text, text, bool | —, —, false | PKP enables §9.2 P1 header fields |
| outlet.timezone | O | tz | Asia/Jakarta | |
| outlet.business_day_cutoff | O | time | 04:00 | |
| outlet.order_number.prefix / reset | O | text / enum(day, never) | "", day | |
| outlet.price_mode | O | enum(inclusive, exclusive) | exclusive | |
| outlet.price_mode_statement | O | text | "Harga belum termasuk pajak & service" | printed on receipt |
| tax.components[] ⏱ | O | list{code,label,rate_bp,inclusive,base_includes_service,order_types[],tax_classes[],effective_from} | PBJT 1000 bp exclusive on makanan_minuman; PPN 1100 bp disabled | |
| tax.classes[] | B | list{code,label} | makanan_minuman, retail_bkp, bebas_pajak | |
| service.rate_bp ⏱ | O | int | 0 | |
| service.order_types[] | O | list | [dine_in] | |
| service.basis | O | enum(after_discount, before_discount) | after_discount | |
| service.taxable | O | bool | true | |
| rounding.increment ⏱ | O | enum(0,50,100,500,1000) | 0 | |
| rounding.mode | O | enum(nearest, up, down) | nearest | |
| rounding.tenders | O | enum(cash_only, all) | cash_only | |
| payment.methods[] ⏱(mdr) | O | list{code,name,type,enabled,required_fields[],opens_drawer,order_types[],mdr_bp,settlement_days} | Tunai, QRIS statis, EDC Debit, EDC Kredit, Transfer | |
| order.types[] | O | list{code,name,requires_table,requires_customer,service_applies,tax_components[],price_book,requires_pax} | dine_in, takeaway, delivery, pickup | |
| order.void_reasons[] / order.discount_reasons[] | B | list | Indonesian defaults | |
| order.allow_open_items | O | bool | true | |
| order.multiple_tabs_per_table | O | bool | false | |
| order.reopen_cross_day | O | bool | false | |
| discount.max_percent_by_role | O | map(role→bp) | cashier 1000 | |
| discount.approval_above_bp / _above_amount | O | int / int | 1000 / 100000 | |
| kitchen.stations[] | O | list{code,name,printer_id,backup_printer_id,kds_enabled,print_when(always, kds_offline)} | dapur, bar | |
| kitchen.deduct_stock_on | O | enum(send, payment) | send | |
| kitchen.void_returns_stock | O | bool | true | |
| kds.warn_seconds / kds.late_seconds | O | int / int | 600 / 900 | |
| kds.bump_mode | O | enum(ticket, item) | item | |
| shift.mode | O | enum(per_terminal, per_cashier) | per_terminal | |
| shift.required_for_sales | O | bool | true | |
| shift.blind_close | O | bool | false | |
| shift.variance_threshold | O | int (Rp) | 20000 | |
| shift.auto_close_at_cutoff | O | bool | false | |
| receipt.paper_width | D | enum(58, 80) | 80 | |
| receipt.auto_print / receipt.copies | D | bool / int | true / 1 | |
| receipt.show_qris_static | O | bool | false | |
| receipt.header / footer | O | text | — | |
| security.pin_length | B | int 4–6 | 6 | |
| security.pin_max_attempts / lock_minutes | B | int / int | 5 / 5 | |
| security.mobile_idle_lock_seconds | O | int | 120 | 0 disables |
| security.desktop_idle_lock_seconds | O | int | 0 | |
| reservation.default_duration_min | O | int | 90 | |
| reservation.lead_block_min | O | int | 30 | |
| reservation.no_show_grace_min | O | int | 15 | |
| reservation.deposit_required_above_pax | O | int | 0 | 0 disables |
| inventory.negative_stock_allowed | O | bool | true | |
| inventory.auto_sold_out_at_zero | O | bool | false | |
| inventory.low_stock_alert | O | bool | true | |
| sync.interval_seconds | O | int | 15 | |
| sync.catalogue_managed_by | O | enum(cloud, local) | local (S), cloud (C) | |
| sync.mobile_queue_max_ops / _max_minutes | O | int / int | 50 / 15 | |
| backup.folder / backup.retention_days / backup.time | D | path / int / time | — / 14 / 03:30 | |
| device.printers[] | D | list{id,name,transport,address,width,roles[]} | — | |
| device.cash_drawer.printer_id | D | id | — | |
| device.customer_display.enabled | D | bool | false | |
| customer.consent_purposes[] | B | list | receipt, loyalty, marketing | |
| customer.retention_months | B | int | 24 | |

## Appendix C — Bill math worked examples

Order: line total → line discount → subtotal → bill discount → service charge → tax → rounding → total. Integers throughout; half-up at each rounding step; per-line allocation by largest remainder.

**C1. Exclusive mode, Jakarta-style (PBJT 10%, service 5% taxable, cash rounding nearest 500)**

| Step | Amount (Rp) |
| --- | --- |
| Nasi Goreng 2 × 45,000 | 90,000 |
| Es Teh 1 × 10,000 | 10,000 |
| Subtotal | 100,000 |
| Bill discount 10% | −10,000 |
| Discounted subtotal | 90,000 |
| Service 5% × 90,000 | 4,500 |
| Tax base (90,000 + 4,500) | 94,500 |
| PBJT 10% × 94,500 | 9,450 |
| Total before rounding | 103,950 |
| Pembulatan (cash, nearest 500) | +50 |
| **Total (cash)** | **104,000** |
| Tendered 110,000 → change | 6,000 |

Paid by QRIS instead: no rounding line; total 103,950.

**C2. Inclusive mode (menu price includes service 5% and PBJT 10%)**

Item “Kopi Susu” listed at Rp 55,000. The total is authoritative; components are derived and must sum exactly.

| Step | Amount (Rp) |
| --- | --- |
| Total (as listed) | 55,000 |
| Tax base = round(55,000 / 1.10) | 50,000 |
| PBJT = 55,000 − 50,000 | 5,000 |
| Net = round(50,000 / 1.05) | 47,619 |
| Service = 50,000 − 47,619 | 2,381 |
| Check: 47,619 + 2,381 + 5,000 | 55,000 |

Receipt shows: Kopi Susu 55,000; “Termasuk service 2,381 dan PBJT 5,000”; statement “Harga sudah termasuk pajak & service”.

**C3. Split bill evenly into 3 from C1 (QRIS, total 103,950)**

Parts: 34,650 / 34,650 / 34,650 (sum 103,950). Tax 9,450 allocated 3,150 / 3,150 / 3,150; service 4,500 → 1,500 each. Where division leaves remainders, the extra rupiah go to the first parts (largest remainder), and the sum of parts must equal the original to the rupiah.

## Appendix D — Sources consulted

Indonesian competitors: mokapos.com (pricing, offline sync, tax settings), majoo.id (harga, Local Server, service charge), esb.id (pricing, POS, Order, Kitchen), pawoon.com and help centre, olsera.com (pricing, offline toggle, rounding), isellercommerce.com, qasir.id (pricing, offline behaviour), kasirpintar.co.id help (LAN server, EDC manual, service fee), nutapos.com, loyverse.com (offline work, KDS, rounding), ireappos.com, runchise.com, pos.youtap.id; roundups by HashMicro, FounderPlus, klikit, Mas Software; consumer letters on mediakonsumen.com.

International systems: Toast documentation (offline mode and local sync, offline card payments, permissions reference, KDS quick reference, course firing, transfers, cash drawer states, close out day, pre-authorisation, void vs refund, pricing features, discounts, saving and publishing, nightly export, Toast Tables); Square for Restaurants help (offline mode, split checks, comp and void, KDS routing, seats, hold and fire, cash drawer sessions, cash rounding, location price overrides); Lightspeed K-Series help (networking, sales period, KDS 2.0, recipes, user groups, surcharging, printing profiles) and O-Series offline; TouchBistro (hybrid POS, multiple iPads, payments, checkout, reservations); Revel (Always On, network guide, recipes, stocktake); Oracle MICROS Simphony (CAPS, workstation online/offline modes, menu levels, hold and fire, KDS); Clover (offline payments); SpotOn (offline mode); Odoo POS (restaurant, cash rounding, cash control, receipt printers).

Regulation and payments: UU 1/2022 HKPD and Perda DKI 1/2024, Bandung 1/2024, Surabaya 7/2023, Denpasar 5/2023, Badung 7/2023; Pergub DKI 35/2024 and 31/2024 (dpp.jakarta.go.id, bapenda.jakarta.go.id); pajakonline.tangerangkota.go.id; ortax.org and DDTC news on PBJT and PER-11/PJ/2025; pajak.go.id on PPN 12% and PMK 131/2024; Permenaker 7/2016 via hukumonline and jdih.kemnaker.go.id; Permendag 35/M-DAG/PER/7/2013 (peraturan.bpk.go.id); Bank Indonesia MDR QRIS pages and Kompas on the 1 October 2026 change; BCA QRIS settlement notice; midtrans.com/id/biaya; CNN Indonesia and Detik on debit MDR and the surcharge ban; kasirpintar, DealPOS and Accurate help on EDC manual and ECR; majoo and DealPOS on WhatsApp receipts; cekat.ai and wati.io on WhatsApp API pricing; Epson, Blueprint, Loyverse supported printers; GoBiz Developer Portal; GrabFood Partner API v1.1.3; Kompas on GoFood commission; klikit on delivery commissions; UU 27/2022 and PP 33/2026 coverage (peraturan.bpk.go.id, kres.id, kompas.id).
