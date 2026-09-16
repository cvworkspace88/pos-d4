import assert from 'node:assert/strict';
import test from 'node:test';
import { conflictField, normalizeCode, staffDiff } from './outlet-rules.ts';

test('a code is stored trimmed and uppercase, so br2 and BR2 collide', () => {
  assert.equal(normalizeCode(' br2 '), 'BR2');
});

test('an already-uppercase code survives untouched', () => {
  assert.equal(normalizeCode('HQ'), 'HQ');
});

test('disjoint rosters swap wholesale', () => {
  assert.deepEqual(staffDiff(['a', 'b'], ['c']), { add: ['c'], remove: ['a', 'b'] });
});

test('an unchanged roster writes nothing', () => {
  assert.deepEqual(staffDiff(['a', 'b'], ['b', 'a']), { add: [], remove: [] });
});

test('an empty roster removes everyone', () => {
  assert.deepEqual(staffDiff(['a', 'b'], []), { add: [], remove: ['a', 'b'] });
});

test('a duplicate in the desired list is added once', () => {
  assert.deepEqual(staffDiff([], ['a', 'a']), { add: ['a'], remove: [] });
});

test('an outlet with no staff yet just adds', () => {
  assert.deepEqual(staffDiff([], ['a', 'b']), { add: ['a', 'b'], remove: [] });
});

test('a unique violation is traced back to the field the user typed', () => {
  assert.equal(conflictField('outlets_name_active_idx'), 'name');
  assert.equal(conflictField('outlets_code_active_idx'), 'code');
});

test('someone else constraint is not ours to explain', () => {
  assert.equal(conflictField('tables_name_active_idx'), null);
  assert.equal(conflictField(''), null);
});
