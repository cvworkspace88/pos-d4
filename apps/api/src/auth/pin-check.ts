import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db/db.module';
import { users, type User } from '../db/schema';
import { Reason } from '../trpc/error-formatter';
import { PIN_MAX_FAILURES, PIN_WINDOW_MS, pinLockedFor } from './pin-policy';

type Columns = {
  failures: typeof users.pinFailures | typeof users.approvalFailures;
  windowStartedAt: typeof users.pinWindowStartedAt | typeof users.approvalWindowStartedAt;
};

/** `'pin'`: the user's own PIN (PIN login). `'approval'`: wrong manager PINs this user typed (US-010). */
export type AttemptCounter = 'pin' | 'approval';

const COLUMNS: Record<AttemptCounter, Columns> = {
  pin: { failures: users.pinFailures, windowStartedAt: users.pinWindowStartedAt },
  approval: { failures: users.approvalFailures, windowStartedAt: users.approvalWindowStartedAt },
};

// `pinLockedFor` / `nextPinFailure` in SQL, on the DB clock so concurrent requests agree.
const pinWindow = sql`(${PIN_WINDOW_MS}::int * interval '1 millisecond')`;
const max = sql`${PIN_MAX_FAILURES}::int`;
const freshOf = (c: Columns) =>
  sql`(${c.windowStartedAt} is null or now() - ${c.windowStartedAt} >= ${pinWindow})`;
const lockedOf = (c: Columns) =>
  sql`(${c.failures} >= ${max} and ${c.windowStartedAt} is not null and now() - ${c.windowStartedAt} < ${pinWindow})`;

/**
 * Counts one attempt BEFORE the PIN is checked, by one conditional UPDATE that refuses a locked row,
 * so concurrent and tRPC-batched guesses each count. Null = already locked.
 */
export async function reserveAttempt(
  db: Database,
  userId: string,
  counter: AttemptCounter,
): Promise<{ failures: number; windowStartedAt: Date } | null> {
  const c = COLUMNS[counter];
  const fresh = freshOf(c);
  const [row] = await db
    .update(users)
    .set({
      [counter === 'pin' ? 'pinFailures' : 'approvalFailures']:
        sql`case when ${fresh} then 1 else ${c.failures} + 1 end`,
      [counter === 'pin' ? 'pinWindowStartedAt' : 'approvalWindowStartedAt']:
        sql`case when ${fresh} or ${c.failures} + 1 >= ${max} then now() else ${c.windowStartedAt} end`,
    })
    .where(and(eq(users.id, userId), sql`not ${lockedOf(c)}`))
    .returning({ failures: c.failures, windowStartedAt: c.windowStartedAt });
  return row ? { failures: row.failures, windowStartedAt: row.windowStartedAt! } : null;
}

/** Remaining lock in ms (0 = free), from a fresh read. */
export async function lockedForMs(db: Database, userId: string, counter: AttemptCounter): Promise<number> {
  const c = COLUMNS[counter];
  const [row] = await db
    .select({ pinFailures: c.failures, pinWindowStartedAt: c.windowStartedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row ? pinLockedFor(row) : 0;
}

export async function resetAttempts(
  db: Database | Tx,
  userId: string,
  counter: AttemptCounter,
): Promise<void> {
  const fields =
    counter === 'pin'
      ? { pinFailures: 0, pinWindowStartedAt: null }
      : { approvalFailures: 0, approvalWindowStartedAt: null };
  await db.update(users).set(fields).where(eq(users.id, userId));
}

/** Whole minutes left, never "0 menit": app and DB clocks may disagree by a moment. */
export const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * The user's own PIN, for `auth.pinLogin`. Locked → FORBIDDEN (never 401, which would sign the caller
 * out); wrong digits → UNAUTHORIZED + `INVALID_PIN`; false when the user has no PIN at all.
 */
export async function verifyPin(db: Database, user: User, pin: string): Promise<boolean> {
  if (!user.pinHash) return false;
  if (!(await reserveAttempt(db, user.id, 'pin')))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `PIN terkunci. Coba lagi dalam ${minutesLeft(await lockedForMs(db, user.id, 'pin'))} menit.`,
    });
  if (await argon2.verify(user.pinHash, pin)) {
    await resetAttempts(db, user.id, 'pin');
    return true;
  }
  throw new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'PIN tidak cocok.',
    cause: new Reason('INVALID_PIN'),
  });
}
