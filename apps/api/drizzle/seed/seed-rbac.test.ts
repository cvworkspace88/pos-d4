import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PERMISSIONS, holdersOf } from './seed-rbac.ts';

test('an approve gate belongs to owner and manager', () => {
  assert.deepEqual(holdersOf('sales.void_approve'), ['owner', 'manager']);
});

test('listed roles come after owner and manager', () => {
  assert.deepEqual(holdersOf('sales.create'), ['owner', 'manager', 'cashier']);
});

test('settings.manage is owner only — manager does not hold everything after all', () => {
  assert.deepEqual(holdersOf('settings.manage'), ['owner']);
});

test('manager is granted, never assumed: an empty list is the owner alone', () => {
  assert.deepEqual(
    Object.keys(PERMISSIONS)
      .filter((p) => PERMISSIONS[p]!.roles.length === 0)
      .sort(),
    ['outlet.create', 'outlet.delete', 'outlet.view_all', 'role.view', 'settings.manage'],
  );
  // Owner is the only implicit holder, and an unlisted permission grants nobody else.
  for (const permission of Object.keys(PERMISSIONS))
    assert.ok(holdersOf(permission).includes('owner'), permission);
  assert.deepEqual(holdersOf('nothing.declared'), ['owner']);
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

test('the set of outlets is the owner alone: who exists, and who may see them all', () => {
  for (const permission of ['outlet.create', 'outlet.delete', 'outlet.view_all'])
    assert.deepEqual(holdersOf(permission), ['owner'], permission);
});

test('one outlet is the manager job — its settings and its roster', () => {
  assert.deepEqual(holdersOf('outlet.manage'), ['owner', 'manager']);
  assert.deepEqual(holdersOf('outlet.staff_assign'), ['owner', 'manager']);
});

// Floor roles hold nothing here: the outlets they may work at already arrive with every login
// and refresh, and reading their own outlet needs no permission either.
test('no floor role holds an outlet permission', () => {
  for (const permission of Object.keys(PERMISSIONS).filter((p) => p.startsWith('outlet.')))
    assert.deepEqual(
      PERMISSIONS[permission]!.roles,
      holdersOf(permission).includes('manager') ? ['manager'] : [],
      permission,
    );
});
