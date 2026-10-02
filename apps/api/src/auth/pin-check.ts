import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db/db.module';
import { users, type User } from '../db/schema';
import { Reason } from '../trpc/error-formatter';
import { PASSWORD_WINDOW_MS, PIN_MAX_FAILURES, PIN_WINDOW_MS, pinLockedFor } from './pin-policy';

type Columns = {
  failures: typeof users.pinFailures | typeof users.approvalFailures | typeof users.passwordFailures;
  windowStartedAt:
    | typeof users.pinWindowStartedAt
    | typeof users.approvalWindowStartedAt
    | typeof users.passwordWindowStartedAt;
  keys:
    | ['pinFailures', 'pinWindowStartedAt']
    | ['approvalFailures', 'approvalWindowStartedAt']
    | ['passwordFailures', 'passwordWindowStartedAt'];
  windowMs: number;
};

/**
 * `'pin'`: the user's own PIN (PIN login). `'approval'`: wrong manager PINs this user typed (US-010).
 * `'password'`: the user's password (login, `setPin`; US-005).
 */
export type AttemptCounter = 'pin' | 'approval' | 'password';

const COLUMNS: Record<AttemptCounter, Columns> = {
  pin: {
    failures: users.pinFailures,
    windowStartedAt: users.pinWindowStartedAt,
    keys: ['pinFailures', 'pinWindowStartedAt'],
    windowMs: PIN_WINDOW_MS,
  },
  approval: {
    failures: users.approvalFailures,
    windowStartedAt: users.approvalWindowStartedAt,
    keys: ['approvalFailures', 'approvalWindowStartedAt'],
    windowMs: PIN_WINDOW_MS,
  },
  password: {
    failures: users.passwordFailures,
    windowStartedAt: users.passwordWindowStartedAt,
    keys: ['passwordFailures', 'passwordWindowStartedAt'],
    windowMs: PASSWORD_WINDOW_MS,
  },
};

// `pinLockedFor` / `nextPinFailure` in SQL, on the DB clock so concurrent requests agree.
const windowOf = (c: Columns) => sql`(${c.windowMs}::int * interval '1 millisecond')`;
const max = sql`${PIN_MAX_FAILURES}::int`;
const freshOf = (c: Columns) =>
  sql`(${c.windowStartedAt} is null or now() - ${c.windowStartedAt} >= ${windowOf(c)})`;
const lockedOf = (c: Columns) =>
  sql`(${c.failures} >= ${max} and ${c.windowStartedAt} is not null and now() - ${c.windowStartedAt} < ${windowOf(c)})`;

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
  const [failuresKey, windowKey] = c.keys;
  const [row] = await db
    .update(users)
    .set({
      [failuresKey]: sql`case when ${fresh} then 1 else ${c.failures} + 1 end`,
      [windowKey]: sql`case when ${fresh} or ${c.failures} + 1 >= ${max} then now() else ${c.windowStartedAt} end`,
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
  return row ? pinLockedFor(row, Date.now(), c.windowMs) : 0;
}

export async function resetAttempts(
  db: Database | Tx,
  userId: string,
  counter: AttemptCounter,
): Promise<void> {
  const [failuresKey, windowKey] = COLUMNS[counter].keys;
  await db
    .update(users)
    .set({ [failuresKey]: 0, [windowKey]: null })
    .where(eq(users.id, userId));
}

/** Whole minutes left, never "0 menit": app and DB clocks may disagree by a moment. */
export const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * A login lock (PIN or password): FORBIDDEN, never 401, which would sign the caller out, with
 * `LOCKED` so clients show the "Terlalu banyak percobaan gagal" dialog rather than a plain alert.
 */
const locked = async (db: Database, userId: string, counter: 'pin' | 'password') =>
  new TRPCError({
    code: 'FORBIDDEN',
    message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${minutesLeft(await lockedForMs(db, userId, counter))} menit.`,
    cause: new Reason('LOCKED'),
  });

/**
 * The user's own password, for `auth.login` and the password check in `auth.setPin` (US-005). Counted
 * before it is checked, like the PIN; a right password clears the count. Locked → FORBIDDEN + `LOCKED`
 * even for the right password. False = wrong password; the caller picks the refusal.
 */
export async function verifyPassword(db: Database, user: User, password: string): Promise<boolean> {
  if (!(await reserveAttempt(db, user.id, 'password'))) throw await locked(db, user.id, 'password');
  if (!(await argon2.verify(user.passwordHash, password))) return false;
  await resetAttempts(db, user.id, 'password');
  return true;
}

/**
 * The user's own PIN, for `auth.pinLogin`. Locked → FORBIDDEN + `LOCKED`; wrong digits → UNAUTHORIZED
 * + `INVALID_PIN`; false when the user has no PIN at all.
 */
export async function verifyPin(db: Database, user: User, pin: string): Promise<boolean> {
  if (!user.pinHash) return false;
  if (!(await reserveAttempt(db, user.id, 'pin'))) throw await locked(db, user.id, 'pin');
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
