import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // argon2 hash of a 6-digit PIN. NULL = never set. Only staff enrolled on a shared tablet need
  // one; desktop users sign in with the password alone.
  pinHash: text('pin_hash'),
  // The GLOBAL role: applies at every outlet and needs no `outlet_staff` row. Only the owner is
  // meant to have one; everyone else's role lives on `outlet_staff.role_id` per outlet. No API
  // sets this yet — only the seed does.
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // Soft delete: staff leave but their sales and audit rows must keep pointing at a real user.
  // Every lookup that authenticates someone filters this out.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Why the row died — or paused. Only a rotation earns the refresh grace window: a sign-out must
    // not, or the token stays usable for the length of that window after the user believed they were
    // out. `parked` is "signed out, profile kept on the tablet": `refresh` refuses it, `pinLogin`
    // redeems it with the user's PIN. `pin_rotated` is what a PIN login leaves behind — its own
    // grace window, honoured by `pinLogin` alone, so redeeming a profile never re-opens the
    // PIN-free `refresh` path for the token it just consumed.
    revokedReason: text('revoked_reason').$type<'rotated' | 'logout' | 'parked' | 'pin_rotated'>(),
    // The session's active outlet. Lives on the row, not the client, so rotation, PIN unlock and a
    // parked profile all carry it. Null: not chosen yet (zero or many outlets), or the outlet went.
    outletId: uuid('outlet_id').references(() => outlets.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    // Every refresh looks a row up by this hash; without the index it is a sequential scan over a
    // table that gains a row per refresh and never drops one. Unique because the hash is of 32
    // random bytes — a collision would mean two sessions sharing one row.
    uniqueIndex('refresh_tokens_token_hash_idx').on(table.tokenHash),
  ],
);

export type User = typeof users.$inferSelect;

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Dotted `domain.action`, e.g. `sales.void_approve`. The code checks this string, not the id.
  name: text('name').notNull().unique(),
  // The Indonesian label the UI shows ("Ajukan void penjualan"). Written by the seed from
  // `PERMISSIONS`, which is the one place labels live.
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    // The PK covers role -> permissions lookups; this covers the reverse (who holds X).
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;

/**
 * Per-user exceptions to what the role gives. One row per (user, permission): 'grant' adds what
 * the role lacks, 'revoke' takes back what it gives, and no row at all means inherit the role.
 * The primary key is what stops a grant and a revoke from ever fighting over the same permission.
 */
export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascade matters here: `seedRbac` deletes permissions dropped from PERMISSIONS, and an
    // override pointing at a permission that no longer exists must go with it.
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    effect: text('effect').$type<'grant' | 'revoke'>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionId] }),
    // This table decides who may do what: a misspelled effect has to fail at write time rather
    // than read back as neither a grant nor a revoke.
    check('user_permissions_effect', sql`${table.effect} IN ('grant', 'revoke')`),
  ],
);

export type UserPermission = typeof userPermissions.$inferSelect;

export const settings = pgTable(
  'settings',
  {
    // One row for the whole deployment. The CHECK keeps it that way; readers fall back to code
    // defaults when the row does not exist yet, so nothing has to seed it.
    id: integer('id').primaryKey().default(1),
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull().default(120),
    // Desktop screen lock after this long idle. 0 = off: the desktop locks only by hand.
    desktopLockSeconds: integer('desktop_lock_seconds').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('settings_singleton', sql`${table.id} = 1`),
    check('settings_desktop_lock_seconds', sql`${table.desktopLockSeconds} BETWEEN 0 AND 3600`),
  ],
);

export type Settings = typeof settings.$inferSelect;

export const tables = pgTable(
  'tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    seats: integer('seats').notNull().default(4),
    // Virtual floor canvas 1000×1000 units; clients scale uniformly to their viewport.
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    w: integer('w').notNull().default(100),
    h: integer('h').notNull().default(100),
    // Set on members of a merge group, pointing at the head. Null = standalone or head. The head
    // carries no marker: it is a head because rows point at it.
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
    uniqueIndex('tables_name_active_idx')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('tables_merged_into_id_idx').on(table.mergedIntoId),
  ],
);

export type Table = typeof tables.$inferSelect;

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict on delete: tables are soft-deleted, so this FK is never hit.
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    partySize: integer('party_size').notNull(),
    // The reservation time: date + clock time, timezone-aware. No end time.
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    note: text('note'),
    status: text('status').$type<'booked' | 'seated' | 'cancelled' | 'no_show'>().notNull().default('booked'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('reservations_table_starts_idx').on(table.tableId, table.startsAt)],
);

export type Reservation = typeof reservations.$inferSelect;

/** How an order is served. The router's zod enums repeat it inline: the contract generator cannot hoist it. */
export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const outlets = pgTable(
  'outlets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Short human key shown on receipts and terminal setup, e.g. 'HQ', 'BR2'. Stored uppercase.
    code: text('code').notNull(),
    address: text('address'),
    phone: text('phone'),
    city: text('city'),
    // IANA name, limited to Indonesia's three zones: WIB, WITA, WIT.
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    // One tax per outlet, printed on receipts under this label, e.g. 'PBJT'.
    pbjtLabel: text('pbjt_label').notNull().default('PBJT'),
    // Basis points: 1000 = 10.00%. Integer, like money — never a float.
    pbjtRateBp: integer('pbjt_rate_bp').notNull().default(1000),
    // true: menu prices already include the tax. false: tax is added on top.
    pbjtInclusive: boolean('pbjt_inclusive').notNull().default(false),
    serviceName: text('service_name').notNull().default('Biaya Layanan'),
    serviceRateBp: integer('service_rate_bp').notNull().default(0),
    // true: tax is computed on subtotal + service. false: on subtotal only.
    servicePbjtTaxable: boolean('service_pbjt_taxable').notNull().default(true),
    // Which order types pay the service charge. It is always added on top, never included in prices.
    serviceOrderTypes: text('service_order_types')
      .array()
      .$type<OrderType[]>()
      .notNull()
      .default(sql`ARRAY['dine_in']::text[]`),
    // Which tax a sale carries — PBJT, PPN or none — is decided per menu item, not here. The outlet
    // holds only the numbers and rates those taxes use.
    // Central taxpayer number, digits only: 16 (NIK-based) or the legacy 15. Optional.
    npwp: text('npwp'),
    // Regional taxpayer number for PBJT. Format differs per region, so free text. Optional.
    npwpd: text('npwpd'),
    // true: a PPN item's price already includes PPN. Separate from `pbjt_inclusive` because retail
    // prices are conventionally shown tax-included while restaurant menus usually are not.
    ppnInclusive: boolean('ppn_inclusive').notNull().default(true),
    // Per outlet, like PBJT: the owner sets each outlet's PPN rate. 1100 = 11%.
    ppnRateBp: integer('ppn_rate_bp').notNull().default(1100),
    // Local time (outlet timezone) the business date turns over: a sale at 01:30 with a 04:00
    // cutoff belongs to the previous date.
    businessDayCutoff: time('business_day_cutoff').notNull().default('04:00'),
    // Local time the business day closes itself. Null = closed by hand only.
    businessDayAutoClose: time('business_day_auto_close'),
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
    uniqueIndex('outlets_name_active_idx')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('outlets_code_active_idx')
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    check('outlets_timezone', sql`${table.timezone} IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')`),
    check('outlets_pbjt_rate_bp', sql`${table.pbjtRateBp} BETWEEN 0 AND 10000`),
    check('outlets_service_rate_bp', sql`${table.serviceRateBp} BETWEEN 0 AND 10000`),
    check('outlets_ppn_rate_bp', sql`${table.ppnRateBp} BETWEEN 0 AND 10000`),
    check(
      'outlets_service_order_types',
      sql`${table.serviceOrderTypes} <@ ARRAY['dine_in', 'takeaway', 'delivery']::text[]`,
    ),
  ],
);

/** Which staff may work at an outlet, and as what. No row = not assigned; zero outlets is a valid state. */
export const outletStaff = pgTable(
  'outlet_staff',
  {
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    // The column is `user_id`, not `staff_id`: it is an FK to `users`. "Staff" is the role word.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // What this user IS at this outlet. Restrict, not cascade: roles are never pruned by the seed,
    // and a hard delete of one must not silently strip staff of their role.
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
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

/** How an item is sold: by the piece or by weight. The router's zod enum repeats it inline: the contract generator cannot hoist it. */
export const SOLD_BY = ['unit', 'weight'] as const;
export type SoldBy = (typeof SOLD_BY)[number];

/**
 * Where food is made: Bar, Dapur Panas, Dessert. Per outlet, like the menu: a category or item says
 * which of its outlet's stations makes it. Printer and KDS mode arrive with US-036. No API writes
 * this table yet; tests insert rows directly.
 */
export const kitchenStations = pgTable(
  'kitchen_stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    // Off: retired. Kept, not deleted, because categories and items point at it.
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('kitchen_stations_outlet_name_idx').on(table.outletId, table.name)],
);

export type KitchenStation = typeof kitchenStations.$inferSelect;

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    name: text('name').notNull(),
    // 0-based position on the cashier screen. Gaps after a delete are harmless: lists sort by it.
    sortOrder: integer('sort_order').notNull(),
    // Tile colour on the cashier screen, `#rrggbb`. Null: the default.
    color: text('color'),
    // Where this category's items are made unless an item says otherwise; a station of the same
    // outlet. Null: the outlet's default station (Phase 4 setting `kitchen.default_station_id`).
    kitchenStationId: uuid('kitchen_station_id').references(() => kitchenStations.id, {
      onDelete: 'set null',
    }),
    // Off: hidden from the cashier screen with everything in it. Not a delete.
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft delete: catalogue data, and menu items point at it.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Each outlet has its own menu. A deleted 'Minuman' can be recreated; only live names must be
    // unique, per outlet.
    uniqueIndex('categories_outlet_name_active_idx')
      .on(table.outletId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    // Not unique: `reorder` rewrites every row in one transaction and would trip it mid-update.
    index('categories_outlet_sort_idx').on(table.outletId, table.sortOrder),
  ],
);

export type Category = typeof categories.$inferSelect;

/** Which tax a menu item carries. The router's zod enums repeat it inline: the contract generator cannot hoist it. */
export const TAX_KINDS = ['pbjt', 'ppn', 'none'] as const;
export type Tax = (typeof TAX_KINDS)[number];

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    // Restrict on delete: categories are soft-deleted, and a category with live items refuses to go.
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    // Kode menu (the PRD's `sku`), optional. Stored uppercase; unique among live items of the outlet
    // when present.
    code: text('code'),
    // Rupiah, integer (the PRD's `base_price`). Order lines will snapshot it, so editing it never
    // rewrites a sale.
    price: integer('price').notNull(),
    // Hand-entered cost price (harga modal), rupiah. Null = not entered.
    cost: integer('cost'),
    // Which tax a sale of this item carries (the PRD's `tax_type`); the outlet holds the rates.
    tax: text('tax').$type<Tax>().notNull().default('pbjt'),
    // Short name printed on kitchen tickets ("NasGor"). Null: the name.
    kitchenName: text('kitchen_name'),
    description: text('description'),
    imageUrl: text('image_url'),
    // Overrides the category's station; a station of the same outlet. Null: inherit.
    kitchenStationId: uuid('kitchen_station_id').references(() => kitchenStations.id, {
      onDelete: 'set null',
    }),
    soldBy: text('sold_by').$type<SoldBy>().notNull().default('unit'),
    // Position within the category. Nothing writes it yet; lists sort by it, then name.
    sortOrder: integer('sort_order').notNull().default(0),
    // Off: hidden from the outlet's cashier screen. Not a delete, and not sold-out: that arrives
    // with `item_availability` (US-018).
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Soft delete: catalogue data, and order lines will point at it.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Only live names must be unique, per outlet.
    uniqueIndex('menu_items_outlet_name_active_idx')
      .on(table.outletId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('menu_items_outlet_code_active_idx')
      .on(table.outletId, table.code)
      .where(sql`${table.deletedAt} IS NULL AND ${table.code} IS NOT NULL`),
    // Also serves the category-delete check for live items.
    index('menu_items_category_idx').on(table.categoryId),
    check('menu_items_price', sql`${table.price} >= 0`),
    check('menu_items_cost', sql`${table.cost} >= 0`),
    check('menu_items_tax', sql`${table.tax} IN (${sql.raw(TAX_KINDS.map((t) => `'${t}'`).join(', '))})`),
    check(
      'menu_items_sold_by',
      sql`${table.soldBy} IN (${sql.raw(SOLD_BY.map((s) => `'${s}'`).join(', '))})`,
    ),
  ],
);

export type MenuItem = typeof menuItems.$inferSelect;

/**
 * A sellable size/temperature of one menu item, each with its own full price. An item with any live
 * variant is sold as one of them; its own `price` is then only the lowest, for display.
 */
export const menuVariants = pgTable(
  'menu_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    cost: integer('cost'),
    available: boolean('available').notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
    // Soft delete: order lines will point at a variant.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Not unique on name: `duplicateName` refuses repeats per save, and a row-by-row set-save would
    // trip a unique index on a rename chain (Regular→Large, Large→Jumbo).
    index('menu_variants_item_idx').on(table.menuItemId),
    check('menu_variants_price', sql`${table.price} >= 0`),
    check('menu_variants_cost', sql`${table.cost} >= 0`),
  ],
);

/** A shared add-on group (Level Pedas, Topping), linked to many menu items of one outlet. */
export const addonGroups = pgTable(
  'addon_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    name: text('name').notNull(),
    // How many options a customer picks. Required ⇔ min_select >= 1.
    minSelect: integer('min_select').notNull(),
    maxSelect: integer('max_select').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('addon_groups_outlet_name_active_idx')
      .on(table.outletId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    check('addon_groups_min', sql`${table.minSelect} >= 0`),
    check('addon_groups_max', sql`${table.maxSelect} >= 1`),
    check('addon_groups_min_max', sql`${table.minSelect} <= ${table.maxSelect}`),
  ],
);

export const addonOptions = pgTable(
  'addon_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => addonGroups.id),
    name: text('name').notNull(),
    // Added to the line price. 0 is real: "Tidak pedas".
    price: integer('price').notNull(),
    available: boolean('available').notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
    // Soft delete: order lines will point at an option.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Not unique on name, for the same reason as `menu_variants_item_idx`.
    index('addon_options_group_idx').on(table.groupId),
    check('addon_options_price', sql`${table.price} >= 0`),
  ],
);

/** Which add-on groups a menu item offers, in order. Config, not history: rows are hard-deleted. */
export const menuItemAddonGroups = pgTable(
  'menu_item_addon_groups',
  {
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    addonGroupId: uuid('addon_group_id')
      .notNull()
      .references(() => addonGroups.id),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.menuItemId, table.addonGroupId] }),
    // "Dipakai di N menu" and the group delete's unlink.
    index('menu_item_addon_groups_group_idx').on(table.addonGroupId),
  ],
);

/**
 * Which part of the app an audit row is about. The router's zod enum repeats it inline: the
 * contract generator cannot hoist it. Later stories append (`role`, `approval`, `order`, `payment`…).
 */
export const AUDIT_MODULES = ['settings', 'outlet', 'staff', 'category', 'menu', 'addon'] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

/**
 * Who changed what, when, from what to what (US-011). Insert-only: a trigger in the migrations
 * refuses UPDATE and DELETE, so not even a bug can rewrite history. Written in the same
 * transaction as the change it records, through `audit()` in `src/audit/audit.ts`.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null = a deployment-wide change (app settings), visible to global roles only.
    outletId: uuid('outlet_id').references(() => outlets.id),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    // The manager who approved the action with their PIN (US-010). Null = no approval needed.
    approverUserId: uuid('approver_user_id').references(() => users.id),
    module: text('module').$type<AuditModule>().notNull(),
    // `module.verb`, e.g. 'menu.item_update'. The CHECK keeps the prefix honest.
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    // Null for a batch action with no single subject, e.g. a category reorder.
    entityId: text('entity_id'),
    reason: text('reason'),
    // Changed fields only, secrets masked (`auditDiff`). Null before = created, null after = deleted.
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    // Null until devices exist (US-003/US-005).
    deviceId: text('device_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_outlet_created_idx').on(table.outletId, table.createdAt.desc(), table.id.desc()),
    index('audit_log_outlet_module_idx').on(table.outletId, table.module, table.createdAt.desc()),
    check('audit_log_action_prefix', sql`${table.action} LIKE ${table.module} || '.%'`),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
