import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
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

export const settings = pgTable(
  'settings',
  {
    // One row for the whole deployment. The CHECK keeps it that way; readers fall back to code
    // defaults when the row does not exist yet, so nothing has to seed it.
    id: integer('id').primaryKey().default(1),
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull().default(120),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('settings_singleton', sql`${table.id} = 1`)],
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
    uniqueIndex('tables_name_active_idx').on(table.name).where(sql`${table.deletedAt} IS NULL`),
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

export type Reservation = typeof reservations.$inferSelect;
