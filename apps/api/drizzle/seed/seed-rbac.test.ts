import assert from 'node:assert/strict';
import { test } from 'vitest';
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

test('table.merge is a direct floor action held by waiter and cashier', () => {
  assert.deepEqual(holdersOf('table.merge'), ['owner', 'manager', 'waiter', 'cashier']);
});

test('the request/approve merge pair is gone', () => {
  assert.equal('table.merge_request' in PERMISSIONS, false);
  assert.equal('table.merge_approve' in PERMISSIONS, false);
});

test('table lifecycle and layout are manager and owner only', () => {
  for (const permission of ['table.create', 'table.delete', 'table.layout_manage'])
    assert.deepEqual(holdersOf(permission), ['owner', 'manager'], permission);
});

test('reservations are floor-staff work', () => {
  for (const permission of ['reservation.view', 'reservation.create', 'reservation.update'])
    assert.deepEqual(holdersOf(permission), ['owner', 'manager', 'waiter', 'cashier'], permission);
});

test('opening and closing an outlet is the owner alone', () => {
  assert.deepEqual(holdersOf('outlet.manage'), ['owner']);
});

test('moving staff between outlets is the manager job too', () => {
  assert.deepEqual(holdersOf('outlet.staff_assign'), ['owner', 'manager']);
});

test('every role can see the outlet list', () => {
  assert.deepEqual(holdersOf('outlet.view'), [
    'owner',
    'manager',
    'cashier',
    'waiter',
    'inventory_staff',
    'auditor',
  ]);
});
