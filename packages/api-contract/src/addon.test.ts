import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRule, getSelectAddonErrorMessage } from './addon.ts';

test('optional groups say how many may be picked', () => {
  assert.equal(describeRule(0, 1), 'Opsional, pilih 1');
  assert.equal(describeRule(0, 3), 'Opsional, maks 3');
});

test('required groups say how many must be picked', () => {
  assert.equal(describeRule(1, 1), 'Wajib pilih 1');
  assert.equal(describeRule(1, 2), 'Wajib pilih 1–2');
});

test('a sound rule has no error', () => {
  assert.equal(getSelectAddonErrorMessage({ min: 0, max: 3, optionCount: 2 }), null);
  assert.equal(getSelectAddonErrorMessage({ min: 1, max: 1, optionCount: 3 }), null);
});

test('every broken rule is refused with its own message', () => {
  assert.equal(
    getSelectAddonErrorMessage({ min: 0, max: 1, optionCount: 0 }),
    'Tambahkan minimal satu pilihan.',
  );
  assert.equal(getSelectAddonErrorMessage({ min: 0, max: 0, optionCount: 2 }), 'Pilihan maksimum minimal 1.');
  assert.equal(
    getSelectAddonErrorMessage({ min: 2, max: 1, optionCount: 3 }),
    'Pilihan minimum tidak boleh melebihi maksimum.',
  );
  assert.equal(
    getSelectAddonErrorMessage({ min: 3, max: 3, optionCount: 2 }),
    'Pilihan minimum melebihi jumlah pilihan (2).',
  );
});
