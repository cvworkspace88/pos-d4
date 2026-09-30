import { expect, test } from 'vitest';
import { conflictHandler } from './errors';

const messages = (constraint: string) => (constraint === 'known_idx' ? 'Sudah dipakai.' : null);

test('a unique violation on a known constraint becomes CONFLICT with its message', () => {
  const error = { code: '23505', constraint: 'known_idx' };
  expect(() => conflictHandler(messages)(error)).toThrow(
    expect.objectContaining({ code: 'CONFLICT', message: 'Sudah dipakai.' }),
  );
});

test('a unique violation on an unmapped constraint rethrows, never guesses', () => {
  const error = { code: '23505', constraint: 'unmapped_idx' };
  expect(() => conflictHandler(messages)(error)).toThrow(error as unknown as Error);
});

test('a driver-wrapped unique violation (cause) is read the same way', () => {
  const error = { cause: { code: '23505', constraint: 'known_idx' } };
  expect(() => conflictHandler(messages)(error)).toThrow(
    expect.objectContaining({ code: 'CONFLICT', message: 'Sudah dipakai.' }),
  );
});

test('anything that is not a unique violation rethrows as-is', () => {
  const error = new Error('boom');
  expect(() => conflictHandler(messages)(error)).toThrow(error);
});
