import { pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
