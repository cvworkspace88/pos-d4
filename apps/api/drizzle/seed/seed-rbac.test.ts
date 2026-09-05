import assert from 'node:assert/strict';
import test from 'node:test';
import { OWNER_ONLY, PERMISSIONS, holdersOf } from './seed-rbac.ts';

test('an approve gate belongs to owner and manager', () => {
  assert.deepEqual(holdersOf('sales.void_approve'), ['owner', 'manager']);
});

test('listed roles come after owner and manager', () => {
  assert.deepEqual(holdersOf('sales.create'), ['owner', 'manager', 'cashier']);
});

test('settings.manage is owner only — manager does not hold everything after all', () => {
  assert.deepEqual(holdersOf('settings.manage'), ['owner']);
});

test('every owner-only permission is a real permission', () => {
  for (const permission of OWNER_ONLY) assert.ok(permission in PERMISSIONS, permission);
});
