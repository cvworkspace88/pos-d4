import { expect, test } from 'vitest';
import { addonConflictMessage, selectionError } from './addon-rules';

// Duplicated from packages/api-contract/src/addon.ts's own tests: apps/api cannot import that
// package at runtime (see the comment on selectionError above, in addon-rules.ts), so this copy
// needs its own coverage. This file keeps the local name (selectionError), not the renamed
// api-contract export (getSelectAddonErrorMessage), since it tests apps/api's own duplicate.
test('a sound rule has no error', () => {
  expect(selectionError({ min: 0, max: 3, optionCount: 2 })).toBeNull();
  expect(selectionError({ min: 1, max: 1, optionCount: 3 })).toBeNull();
});

test('every broken rule is refused with its own message', () => {
  expect(selectionError({ min: 0, max: 1, optionCount: 0 })).toBe('Tambahkan minimal satu pilihan.');
  expect(selectionError({ min: 0, max: 0, optionCount: 2 })).toBe('Pilihan maksimum minimal 1.');
  expect(selectionError({ min: 2, max: 1, optionCount: 3 })).toBe(
    'Pilihan minimum tidak boleh melebihi maksimum.',
  );
  expect(selectionError({ min: 3, max: 3, optionCount: 2 })).toBe(
    'Pilihan minimum melebihi jumlah pilihan (2).',
  );
});

test('addonConflictMessage maps the group name index, and nothing else', () => {
  expect(addonConflictMessage('addon_groups_outlet_name_active_idx')).toBe('Nama add-on sudah dipakai.');
  expect(addonConflictMessage('something_else')).toBeNull();
});
