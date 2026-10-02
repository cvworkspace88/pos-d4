import assert from 'node:assert/strict';
import test from 'node:test';
import { uuidv7 } from './id.ts';

test('uuidv7 carries the timestamp, version 7 and the RFC variant', () => {
  const id = uuidv7(new Uint8Array(10).fill(0xff), 0x0123456789ab);
  assert.equal(id, '01234567-89ab-7fff-bfff-ffffffffffff');
});

test('uuidv7 ids sort by time and differ within one millisecond', () => {
  const a = uuidv7(undefined, 1_000);
  const b = uuidv7(undefined, 2_000);
  assert.ok(a < b);
  assert.notEqual(uuidv7(undefined, 1_000), uuidv7(undefined, 1_000));
  assert.match(uuidv7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
