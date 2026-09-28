import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRule } from './addon.ts';

test('optional groups say how many may be picked', () => {
  assert.equal(describeRule(0, 1), 'Opsional, pilih 1');
  assert.equal(describeRule(0, 3), 'Opsional, maks 3');
});

test('required groups say how many must be picked', () => {
  assert.equal(describeRule(1, 1), 'Wajib pilih 1');
  assert.equal(describeRule(1, 2), 'Wajib pilih 1–2');
});
