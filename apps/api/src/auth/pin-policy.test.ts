import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  FIRST_PIN_WINDOW_MS,
  PIN_WINDOW_MS,
  firstPinNeedsPassword,
  nextPinFailure,
  pinLockedFor,
  rejectPinLogin,
} from './pin-policy.ts';
import { REVOKE_GRACE_MS } from './refresh-window.ts';

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);
const ahead = (ms: number) => new Date(NOW + ms);

const row = (over: Partial<Parameters<typeof rejectPinLogin>[0]> = {}) => ({
  expiresAt: ahead(30 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  revokedReason: null,
  ...over,
});

test('a live token can be redeemed with a PIN', () => {
  assert.equal(rejectPinLogin(row(), NOW), null);
});

test('a parked token can be redeemed — that is what parking is for', () => {
  assert.equal(rejectPinLogin(row({ revokedAt: ago(60 * 60 * 1000), revokedReason: 'parked' }), NOW), null);
});

test('a token rotated moments ago still can — the PIN login response may have been lost', () => {
  assert.equal(rejectPinLogin(row({ revokedAt: ago(5_000), revokedReason: 'rotated' }), NOW), null);
});

test('a token rotated past the grace window cannot', () => {
  const past = row({ revokedAt: ago(REVOKE_GRACE_MS + 1), revokedReason: 'rotated' });
  assert.equal(rejectPinLogin(past, NOW), 'revoked');
});

test('a signed-out token cannot', () => {
  assert.equal(rejectPinLogin(row({ revokedAt: ago(1), revokedReason: 'logout' }), NOW), 'revoked');
});

test('a PIN login whose response was lost becomes a retry', () => {
  const justRedeemed = row({ revokedAt: ago(5_000), revokedReason: 'pin_rotated' });
  assert.equal(rejectPinLogin(justRedeemed, NOW), null);
});

test('that retry window closes with the grace period', () => {
  const atEdge = row({ revokedAt: ago(REVOKE_GRACE_MS), revokedReason: 'pin_rotated' });
  const pastEdge = row({ revokedAt: ago(REVOKE_GRACE_MS + 1), revokedReason: 'pin_rotated' });
  assert.equal(rejectPinLogin(atEdge, NOW), null);
  assert.equal(rejectPinLogin(pastEdge, NOW), 'revoked');
});

test('expiry outranks parking', () => {
  const parkedAndExpired = row({ expiresAt: ago(1), revokedAt: ago(1_000), revokedReason: 'parked' });
  assert.equal(rejectPinLogin(parkedAndExpired, NOW), 'expired');
});

const fresh = { pinFailures: 0, pinWindowStartedAt: null };

test('a first wrong PIN opens a window at 1', () => {
  assert.deepEqual(nextPinFailure(fresh, NOW), { pinFailures: 1, pinWindowStartedAt: new Date(NOW) });
  assert.equal(pinLockedFor(fresh, NOW), 0);
});

test('four wrong PINs inside the window do not lock', () => {
  const four = { pinFailures: 4, pinWindowStartedAt: ago(60_000) };
  assert.equal(pinLockedFor(four, NOW), 0);
});

test('the fifth wrong PIN locks for a full window from that failure', () => {
  const fifth = nextPinFailure({ pinFailures: 4, pinWindowStartedAt: ago(9 * 60_000) }, NOW);
  assert.deepEqual(fifth, { pinFailures: 5, pinWindowStartedAt: new Date(NOW) });
  assert.equal(pinLockedFor(fifth, NOW), PIN_WINDOW_MS);
  assert.equal(pinLockedFor(fifth, NOW + PIN_WINDOW_MS - 1), 1);
  assert.equal(pinLockedFor(fifth, NOW + PIN_WINDOW_MS), 0);
});

test('a wrong PIN after the window restarts the count', () => {
  const stale = { pinFailures: 3, pinWindowStartedAt: ago(PIN_WINDOW_MS) };
  assert.deepEqual(nextPinFailure(stale, NOW), { pinFailures: 1, pinWindowStartedAt: new Date(NOW) });
});

test('an expired lock restarts the count on the next wrong PIN', () => {
  const expired = { pinFailures: 5, pinWindowStartedAt: ago(PIN_WINDOW_MS + 1) };
  assert.equal(pinLockedFor(expired, NOW), 0);
  assert.deepEqual(nextPinFailure(expired, NOW), { pinFailures: 1, pinWindowStartedAt: new Date(NOW) });
});

test('a first PIN is free only within five minutes of a password login', () => {
  assert.equal(firstPinNeedsPassword(NOW - 60_000, NOW), false);
  assert.equal(firstPinNeedsPassword(NOW - FIRST_PIN_WINDOW_MS, NOW), false);
  assert.equal(firstPinNeedsPassword(NOW - FIRST_PIN_WINDOW_MS - 1, NOW), true);
  // A session minted by a refresh or a PIN never counts as a fresh password login.
  assert.equal(firstPinNeedsPassword(null, NOW), true);
});
