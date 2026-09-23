import assert from 'node:assert/strict';
import { test } from 'vitest';
import { canManageRole, conflictField, normalizeCode, staffDiff } from './outlet-rules.ts';

test('a code is stored trimmed and uppercase, so br2 and BR2 collide', () => {
  assert.equal(normalizeCode(' br2 '), 'BR2');
});

test('an already-uppercase code survives untouched', () => {
  assert.equal(normalizeCode('HQ'), 'HQ');
});

const e = (userId: string, roleId = 'r1') => ({ userId, roleId });

test('disjoint rosters swap wholesale', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], [e('c')]), { add: [e('c')], remove: ['a', 'b'] });
});

test('an unchanged roster writes nothing', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], [e('b'), e('a')]), { add: [], remove: [] });
});

test('a changed role is a remove plus an add for the same user', () => {
  assert.deepEqual(staffDiff([e('a', 'cashier')], [e('a', 'manager')]), {
    add: [e('a', 'manager')],
    remove: ['a'],
  });
});

test('an empty roster removes everyone', () => {
  assert.deepEqual(staffDiff([e('a'), e('b')], []), { add: [], remove: ['a', 'b'] });
});

test('a duplicate user in the desired list keeps the last role given', () => {
  assert.deepEqual(staffDiff([], [e('a', 'cashier'), e('a', 'manager')]), {
    add: [e('a', 'manager')],
    remove: [],
  });
});

test('an outlet with no staff yet just adds', () => {
  assert.deepEqual(staffDiff([], [e('a'), e('b')]), { add: [e('a'), e('b')], remove: [] });
});

test('a unique violation is traced back to the field the user typed', () => {
  assert.equal(conflictField('outlets_name_active_idx'), 'name');
  assert.equal(conflictField('outlets_code_active_idx'), 'code');
});

test('someone else constraint is not ours to explain', () => {
  assert.equal(conflictField('tables_name_active_idx'), null);
  assert.equal(conflictField(''), null);
});

test('owner manages every role; everyone else stops below manager', () => {
  assert.equal(canManageRole(true, 'manager'), true);
  assert.equal(canManageRole(false, 'manager'), false);
  assert.equal(canManageRole(false, 'owner'), false);
  assert.equal(canManageRole(false, 'cashier'), true);
});
