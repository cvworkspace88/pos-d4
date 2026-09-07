import assert from 'node:assert/strict';
import test from 'node:test';
import { TRPCError } from '@trpc/server';
import { Reason, errorFormatter } from './error-formatter.ts';

// The formatter reads only `shape` and `error`; the rest of the opts bag is inert here.
const reasonOf = (error: TRPCError) =>
  (
    errorFormatter({
      error,
      shape: { message: error.message, code: -32001, data: { code: error.code, httpStatus: 401 } },
    } as never) as { data: { reason?: string } }
  ).data.reason;

test('a wrong PIN is distinguishable from a dead profile despite sharing UNAUTHORIZED', () => {
  const wrongPin = new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong PIN.', cause: new Reason('INVALID_PIN') });
  const deadProfile = new TRPCError({ code: 'UNAUTHORIZED', message: 'Profile expired.' });
  assert.equal(reasonOf(wrongPin), 'INVALID_PIN');
  assert.equal(reasonOf(deadProfile), undefined);
});

test('a thrown Error as cause never leaks its message through reason', () => {
  assert.equal(reasonOf(new TRPCError({ code: 'UNAUTHORIZED', cause: new Error('pg: no relation') })), undefined);
});
