import assert from 'node:assert/strict';
import test from 'node:test';
import { REVOKE_GRACE_MS, rejectRefresh } from './refresh-window.ts';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);
const ahead = (ms: number) => new Date(NOW + ms);

const row = (over: Partial<Parameters<typeof rejectRefresh>[0]> = {}) => ({
  expiresAt: ahead(30 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  revokedReason: null,
  ...over,
});

test('a live token is redeemable', () => {
  assert.equal(rejectRefresh(row(), NOW), null);
});

test('an expired token is not', () => {
  assert.equal(rejectRefresh(row({ expiresAt: ago(1) }), NOW), 'expired');
});

test('expiry outranks revocation', () => {
  const expiredAndRotated = row({ expiresAt: ago(1), revokedAt: ago(1_000), revokedReason: 'rotated' });
  assert.equal(rejectRefresh(expiredAndRotated, NOW), 'expired', 'the reason must not mislead');
});

test('a token rotated moments ago is still redeemable — the response may have been lost', () => {
  assert.equal(rejectRefresh(row({ revokedAt: ago(5_000), revokedReason: 'rotated' }), NOW), null);
});

test('the grace window is inclusive at its edge', () => {
  const atEdge = row({ revokedAt: ago(REVOKE_GRACE_MS), revokedReason: 'rotated' });
  const pastEdge = row({ revokedAt: ago(REVOKE_GRACE_MS + 1), revokedReason: 'rotated' });

  assert.equal(rejectRefresh(atEdge, NOW), null);
  assert.equal(rejectRefresh(pastEdge, NOW), 'revoked');
});

test('a signed-out token gets no grace at all', () => {
  // The bug this pins: sharing one `revoked_at` column between rotation and sign-out let a token
  // presented just after Sign out mint a fresh 30-day chain.
  assert.equal(rejectRefresh(row({ revokedAt: ago(1), revokedReason: 'logout' }), NOW), 'revoked');
});

test('a revoked row with no reason fails closed', () => {
  // `revoked_reason` is nullable and nothing backfills it.
  assert.equal(rejectRefresh(row({ revokedAt: ago(1), revokedReason: null }), NOW), 'revoked');
});

test('a parked token cannot be refreshed without its PIN', () => {
  assert.equal(rejectRefresh(row({ revokedAt: ago(1), revokedReason: 'parked' }), NOW), 'revoked');
});
