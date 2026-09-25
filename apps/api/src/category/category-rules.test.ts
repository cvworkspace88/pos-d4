import { expect, test } from 'vitest';
import { checkReorder } from './category-rules';

test('the same ids in a new order are accepted', () => {
  expect(checkReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
});

test('an outlet with no categories accepts an empty order', () => {
  expect(checkReorder([], [])).toBe(true);
});

test('a missing id is refused: someone added a category meanwhile', () => {
  expect(checkReorder(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
});

test('an extra id is refused: deleted meanwhile, or not this outlet', () => {
  expect(checkReorder(['a', 'b'], ['a', 'b', 'x'])).toBe(false);
});

test('a duplicate id is refused even when the count matches', () => {
  expect(checkReorder(['a', 'b', 'c'], ['a', 'a', 'b'])).toBe(false);
});
