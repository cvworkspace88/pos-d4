import { expect, test } from 'vitest';
import { forViewer } from './menu-rules';

const items = [{ name: 'Nasi Goreng', cost: 12000 }];

test('a manager sees the cost price', () => {
  expect(forViewer(items, ['menu.view', 'menu.manage'])).toEqual(items);
});

test('a reader gets the cost blanked', () => {
  expect(forViewer(items, ['menu.view'])).toEqual([{ name: 'Nasi Goreng', cost: null }]);
});
