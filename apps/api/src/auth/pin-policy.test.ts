import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectPinLogin } from './pin-policy.ts';
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

test('expiry outranks parking', () => {
  const parkedAndExpired = row({ expiresAt: ago(1), revokedAt: ago(1_000), revokedReason: 'parked' });
  assert.equal(rejectPinLogin(parkedAndExpired, NOW), 'expired');
});
