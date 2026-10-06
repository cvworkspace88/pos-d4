import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PERMISSIONS, ROLES, holdersOf } from './seed-rbac.ts';

/** Every permission a role holds, sorted. Mirrors PRD Appendix B one role at a time. */
const grantsOf = (role: string) =>
  Object.keys(PERMISSIONS)
    .filter((p) => holdersOf(p).includes(role))
    .sort();

const CASHIER = [
  'customer.manage',
  'customer.view',
  'drawer.pay_in_out',
  'menu.sold_out',
  'menu.view',
  'order.create',
  'order.discount_bill',
  'order.discount_line',
  'order.merge',
  'order.send',
  'order.split',
  'order.transfer',
  'payment.reprint',
  'payment.take',
  'report.view_shift',
  'reservation.create',
  'reservation.update',
  'reservation.view',
  'shift.close',
  'shift.open',
  'table.merge',
  'table.use',
  'table.view',
];

test('the base roles are the PRD seven', () => {
  assert.deepEqual(
    ROLES.map(([name]) => name),
    ['owner', 'manager', 'supervisor', 'cashier', 'waiter', 'kitchen', 'accountant'],
  );
});

test('the catalogue has 67 permissions and no request/approve pairs', () => {
  assert.equal(Object.keys(PERMISSIONS).length, 67);
  for (const name of Object.keys(PERMISSIONS)) assert.doesNotMatch(name, /_(request|approve)$/, name);
});

test('owner is the only implicit holder, of everything', () => {
  assert.deepEqual(grantsOf('owner'), Object.keys(PERMISSIONS).sort());
  assert.deepEqual(holdersOf('nothing.declared'), ['owner']);
});

test('manager holds everything but roles, overrides, app settings and the set of outlets', () => {
  const ownerOnly = [
    'outlet.create',
    'outlet.delete',
    'outlet.view_all',
    'permission.override',
    'role.manage',
    'role.view',
    'settings.manage',
  ];
  assert.deepEqual(
    grantsOf('manager'),
    Object.keys(PERMISSIONS)
      .filter((p) => !ownerOnly.includes(p))
      .sort(),
  );
});

test('cashier', () => {
  assert.deepEqual(grantsOf('cashier'), CASHIER);
});

test('supervisor is cashier plus the floor approvals', () => {
  assert.deepEqual(
    grantsOf('supervisor'),
    [
      ...CASHIER,
      'approval.grant',
      'drawer.no_sale',
      'kitchen.view',
      'order.cancel',
      'order.comp',
      'order.edit_others',
      'order.void_sent',
      'payment.void',
      'report.view_sales',
      'shift.approve_variance',
      'shift.view_expected',
    ].sort(),
  );
});

test('waiter', () => {
  assert.deepEqual(grantsOf('waiter'), [
    'customer.view',
    'menu.sold_out',
    'menu.view',
    'order.create',
    'order.merge',
    'order.send',
    'order.split',
    'order.transfer',
    'reservation.create',
    'reservation.update',
    'reservation.view',
    'table.merge',
    'table.use',
    'table.view',
  ]);
});

test('kitchen', () => {
  assert.deepEqual(grantsOf('kitchen'), ['kitchen.bump', 'kitchen.view', 'menu.sold_out', 'menu.view']);
});

test('accountant is read-only', () => {
  assert.deepEqual(grantsOf('accountant'), [
    'customer.view',
    'inventory.view',
    'menu.view',
    'report.export',
    'report.view_audit',
    'report.view_sales',
    'report.view_shift',
  ]);
});

test('a permission the code already checks keeps its name', () => {
  for (const name of [
    'category.edit',
    'category.view',
    'menu.manage',
    'menu.view',
    'outlet.create',
    'outlet.delete',
    'outlet.manage',
    'outlet.staff_assign',
    'outlet.view_all',
    'report.view_audit',
    'reservation.create',
    'reservation.update',
    'reservation.view',
    'role.view',
    'settings.manage',
    'table.create',
    'table.delete',
    'table.layout_manage',
    'table.merge',
    'table.view',
  ])
    assert.ok(name in PERMISSIONS, name);
});
