import assert from 'node:assert/strict';
import { test } from 'vitest';
import { type PermissionRow, effectivePermissions } from './rbac-rules.ts';

const role = (...names: string[]): PermissionRow[] =>
  names.map((name): PermissionRow => ({ name, source: 'role' }));
const grant = (name: string): PermissionRow => ({ name, source: 'grant' });
const revoke = (name: string): PermissionRow => ({ name, source: 'revoke' });

test('with no overrides the role set comes back as is', () => {
  assert.deepEqual(effectivePermissions(role('sales.view', 'sales.create')), [
    'sales.create',
    'sales.view',
  ]);
});

test('a grant adds a permission the role does not hold', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), grant('table.view')]), [
    'sales.view',
    'table.view',
  ]);
});

test('a revoke takes back a permission the role holds', () => {
  assert.deepEqual(
    effectivePermissions([...role('sales.view', 'sales.create'), revoke('sales.create')]),
    ['sales.view'],
  );
});

test('a revoke for a permission the role never held changes nothing', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), revoke('settings.manage')]), [
    'sales.view',
  ]);
});

test('a grant duplicating a role permission yields no duplicate', () => {
  assert.deepEqual(effectivePermissions([...role('sales.view'), grant('sales.view')]), [
    'sales.view',
  ]);
});

test('a user with no role and no overrides holds nothing', () => {
  assert.deepEqual(effectivePermissions([]), []);
});
