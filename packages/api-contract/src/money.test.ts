import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRupiah } from './money.ts';

test('plain digits and dotted thousands both parse', () => {
  assert.deepEqual(parseRupiah('35000'), { value: 35000 });
  assert.deepEqual(parseRupiah(' 35.000 '), { value: 35000 });
  assert.deepEqual(parseRupiah('1.250.000'), { value: 1250000 });
  assert.deepEqual(parseRupiah('0'), { value: 0 });
});

test('empty is null, not an error', () => {
  assert.deepEqual(parseRupiah(''), { value: null });
});

test('a decimal comma or a misplaced dot is refused, never stripped', () => {
  for (const input of ['35.000,00', '35,5', '3.50', '35.00.0', 'Rp 35.000', '-5'])
    assert.ok(parseRupiah(input).error, input);
});

test('above the bound is refused', () => {
  assert.deepEqual(parseRupiah('100.000.000'), { value: 100000000 });
  assert.ok(parseRupiah('100.000.001').error);
});
