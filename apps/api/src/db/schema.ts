import { pgTable, text, timestamp, uuid, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
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
    // Why the row died. Only a rotation earns the refresh grace window — a sign-out must not, or the
    // token stays usable for the length of that window after the user believed they were out.
    revokedReason: text('revoked_reason').$type<'rotated' | 'logout'>(),
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
