import { expect, test } from 'vitest';
import { permissionMatrix } from './role-rules';

const p = (...names: string[]) => names.map((name) => ({ name, description: null }));

test('request and approve are separate rows, one flag per role', () => {
  const [group] = permissionMatrix(p('sales.void_request', 'sales.void_approve'), [
    new Set(['sales.void_request', 'sales.void_approve']),
    new Set(['sales.void_request']),
  ]);
  expect(group).toEqual({
    domain: 'sales',
    rows: [
      { key: 'sales.void_approve', description: null, granted: [true, false] },
      { key: 'sales.void_request', description: null, granted: [true, true] },
    ],
  });
});

test('domains group in name order', () => {
  const groups = permissionMatrix(p('table.view', 'sales.view', 'sales.create'), [new Set(['sales.view'])]);
  expect(groups.map((g) => [g.domain, g.rows.map((r) => r.key)])).toEqual([
    ['sales', ['sales.create', 'sales.view']],
    ['table', ['table.view']],
  ]);
});
