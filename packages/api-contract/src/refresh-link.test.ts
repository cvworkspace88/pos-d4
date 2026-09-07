import assert from 'node:assert/strict';
import test from 'node:test';
import { observable } from '@trpc/server/observable';
import { createRefreshLink } from './refresh-link.ts';

const unauthorized = () => Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } });
const offline = () => Object.assign(new Error('Failed to fetch'), { data: undefined });
const ok = { result: { type: 'data', data: { id: 'u1' } } };

/**
 * Drives one operation through the link. `responses` is consumed one entry per attempt: an Error is
 * emitted as a failure, anything else as a value.
 */
function drive(accessToken: (options?: { force?: boolean }) => Promise<string | null>, responses: unknown[]) {
  const attempts: unknown[] = [];
  const next = () =>
    observable((observer) => {
      const response = responses[attempts.length];
      attempts.push(response);
      if (response instanceof Error) observer.error(response as never);
      else {
        observer.next(response as never);
        observer.complete();
      }
    });

  const link = createRefreshLink({ accessToken })({} as never);
  const stream = link({ op: { id: 1, type: 'query', path: 'auth.me' } as never, next: next as never });

  let unsubscribe = () => {};
  const settled = new Promise<{ value?: unknown; error?: unknown }>((resolve) => {
    const inner = stream.subscribe({
      next: (value) => resolve({ value }),
      error: (error) => resolve({ error }),
    });
    unsubscribe = () => inner.unsubscribe();
  });

  return { settled, attempts, unsubscribe };
}

test('an UNAUTHORIZED response is retried once after a forced refresh', async () => {
  const forced: (boolean | undefined)[] = [];
  const accessToken = async (options?: { force?: boolean }) => {
    forced.push(options?.force);
    return 'fresh-token';
  };

  const { settled, attempts } = drive(accessToken, [unauthorized(), ok]);

  assert.deepEqual(await settled, { value: ok });
  assert.equal(attempts.length, 2, 'the operation was sent again');
  assert.deepEqual(forced, [true], 'exactly one refresh, and it bypassed the exp check');
});

test('an error that is not UNAUTHORIZED passes straight through', async () => {
  let refreshes = 0;
  const accessToken = async () => {
    refreshes += 1;
    return 'fresh-token';
  };

  const error = offline();
  const { settled, attempts } = drive(accessToken, [error]);

  assert.deepEqual(await settled, { error });
  assert.equal(attempts.length, 1, 'no retry');
  assert.equal(refreshes, 0, 'no refresh for a network failure');
});

test('a second UNAUTHORIZED ends it — the retry never loops', async () => {
  let refreshes = 0;
  const accessToken = async () => {
    refreshes += 1;
    return 'fresh-token';
  };

  const second = unauthorized();
  const { settled, attempts } = drive(accessToken, [unauthorized(), second]);

  assert.deepEqual(await settled, { error: second });
  assert.equal(attempts.length, 2, 'one retry, not a loop');
  assert.equal(refreshes, 1);
});

test('no token to recover with surfaces the original error', async () => {
  const { settled, attempts } = drive(async () => null, [unauthorized()]);

  const outcome = await settled;
  assert.equal((outcome.error as Error | undefined)?.message, 'UNAUTHORIZED');
  assert.equal(attempts.length, 1, 'nothing is retried without a token');
});

test('a refresh that fails on its own terms surfaces the refresh error, not the 401', async () => {
  // Emitting the original UNAUTHORIZED here would reach the cache hook that ends the session, so an
  // offline blip would cost the user a refresh token that is still perfectly valid.
  const { settled, attempts } = drive(async () => {
    throw offline();
  }, [unauthorized()]);

  const outcome = await settled;
  assert.equal((outcome.error as Error | undefined)?.message, 'Failed to fetch');
  assert.equal(
    (outcome.error as { data?: { code?: string } })?.data?.code,
    undefined,
    'nothing downstream reads this as an auth failure',
  );
  assert.equal(attempts.length, 1);
});

test('unsubscribing during the refresh cancels the retry', async () => {
  let release: (token: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });

  const { attempts, unsubscribe } = drive(() => pending, [unauthorized(), ok]);
  unsubscribe();

  release('fresh-token');
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(attempts.length, 1, 'the cancelled operation was not sent again');
});
