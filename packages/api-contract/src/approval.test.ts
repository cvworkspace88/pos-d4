import assert from 'node:assert/strict';
import test from 'node:test';
import { errorReason, isInvalidPin, needsApproval } from './approval.ts';

const trpcError = (data: unknown) => Object.assign(new Error('x'), { data });

test('errorReason reads data.reason off a tRPC error', () => {
  assert.equal(errorReason(trpcError({ code: 'FORBIDDEN', reason: 'NEEDS_APPROVAL' })), 'NEEDS_APPROVAL');
  assert.equal(errorReason(trpcError({ code: 'FORBIDDEN' })), undefined);
  assert.equal(errorReason(new Error('offline')), undefined);
  assert.equal(errorReason(null), undefined);
});

test('needsApproval and isInvalidPin tell the two reasons apart', () => {
  const refused = trpcError({ code: 'FORBIDDEN', reason: 'NEEDS_APPROVAL' });
  const wrongPin = trpcError({ code: 'UNAUTHORIZED', reason: 'INVALID_PIN' });
  assert.equal(needsApproval(refused), true);
  assert.equal(needsApproval(wrongPin), false);
  assert.equal(isInvalidPin(wrongPin), true);
  assert.equal(isInvalidPin(refused), false);
});
