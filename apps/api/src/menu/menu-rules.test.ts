import { expect, test } from 'vitest';
import {
  duplicateName,
  effectiveStationId,
  forViewer,
  hasDuplicateId,
  menuConflictMessage,
  normalizeCode,
  startingPrice,
} from './menu-rules';

const items = [{ name: 'Es Kopi', cost: 12000, variants: [{ name: 'Large', cost: 9000 }] }];

test('a manager sees the cost price, on the item and on every variant', () => {
  expect(forViewer(items, ['menu.view', 'menu.manage'])).toEqual(items);
});

test('a reader gets every cost blanked', () => {
  expect(forViewer(items, ['menu.view'])).toEqual([
    { name: 'Es Kopi', cost: null, variants: [{ name: 'Large', cost: null }] },
  ]);
});

test('normalizeCode trims and uppercases; blank is null', () => {
  expect(normalizeCode(' ng-01 ')).toBe('NG-01');
  expect(normalizeCode('   ')).toBeNull();
  expect(normalizeCode(null)).toBeNull();
});

test('startingPrice is the lowest price among available variants', () => {
  expect(
    startingPrice([
      { price: 15000, available: false },
      { price: 25000, available: true },
      { price: 20000, available: true },
    ]),
  ).toBe(20000);
});

test('startingPrice falls back to every variant when all are sold out', () => {
  expect(
    startingPrice([
      { price: 25000, available: false },
      { price: 20000, available: false },
    ]),
  ).toBe(20000);
});

test('duplicateName finds a repeat ignoring case and surrounding spaces', () => {
  expect(duplicateName([{ name: 'Regular' }, { name: 'Large' }])).toBeNull();
  expect(duplicateName([{ name: 'Regular' }, { name: ' regular ' }])).toBe('regular');
});

test('menuConflictMessage maps each unique index, and nothing else', () => {
  expect(menuConflictMessage('menu_items_outlet_name_active_idx')).toBe('Nama menu sudah dipakai.');
  expect(menuConflictMessage('menu_items_outlet_code_active_idx')).toBe('Kode menu sudah dipakai.');
  expect(menuConflictMessage('something_else')).toBeNull();
});

test('hasDuplicateId flags one id sent twice; new rows without an id never count', () => {
  expect(hasDuplicateId([{ id: 'a' }, { id: 'b' }, {}, {}])).toBe(false);
  expect(hasDuplicateId([{ id: 'a' }, { id: 'a' }])).toBe(true);
});

test('effectiveStationId is the item’s own station, else the category’s, else null', () => {
  expect(effectiveStationId({ kitchenStationId: 'bar' }, { kitchenStationId: 'kitchen' })).toBe('bar');
  expect(effectiveStationId({ kitchenStationId: null }, { kitchenStationId: 'kitchen' })).toBe('kitchen');
  expect(effectiveStationId({ kitchenStationId: null }, { kitchenStationId: null })).toBeNull();
});
