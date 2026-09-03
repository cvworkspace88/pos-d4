import assert from 'node:assert/strict';
import test from 'node:test';
import { createTokenProvider, expiresWithin, type Session } from './refresh.ts';

/** Builds a JWT-shaped string whose payload expires `seconds` from now. Signature is never checked client-side. */
const jwt = (seconds: number) =>
  `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.signature`;

const session = (accessToken: string, refreshToken = 'r2'): Session => ({
  user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  accessToken,
  refreshToken,
});

function harness(state: { accessToken: string | null; refreshToken: string | null }) {
  const calls: string[] = [];
  let cleared = 0;
  return {
    calls,
    cleared: () => cleared,
    state,
    deps: {
      getState: () => state,
      setSession: (s: Session) => {
        state.accessToken = s.accessToken;
        state.refreshToken = s.refreshToken;
      },
      clear: () => {
        cleared += 1;
        state.accessToken = null;
        state.refreshToken = null;
      },
      refresh: async (token: string) => {
        calls.push(token);
        return session(jwt(900));
      },
    },
  };
}

test('expiresWithin reads the exp claim', () => {
  assert.equal(expiresWithin(jwt(900), 30), false);
  assert.equal(expiresWithin(jwt(-1), 30), true);
  assert.equal(expiresWithin(jwt(10), 30), true, 'inside the skew window counts as expired');
  assert.equal(expiresWithin('not-a-jwt', 30), true, 'unreadable token is treated as dead');
});

test('a live token is returned without refreshing', async () => {
  const h = harness({ accessToken: jwt(900), refreshToken: 'r1' });
  const accessToken = createTokenProvider(h.deps);

  assert.equal(await accessToken(), h.state.accessToken);
  assert.deepEqual(h.calls, []);
});

test('force refreshes a token that still looks live', async () => {
  // The server rejected it, so `exp` is not to be trusted for this attempt. Without force honoured,
  // the retry link would resend the identical stale token and end the session on the second 401.
  const h = harness({ accessToken: jwt(900), refreshToken: 'r1' });
  const accessToken = createTokenProvider(h.deps);

  const token = await accessToken({ force: true });
  assert.deepEqual(h.calls, ['r1'], 'a refresh happened despite exp saying the token was live');
  assert.equal(token, h.state.accessToken);
  assert.equal(h.state.refreshToken, 'r2', 'the new session was stored, not discarded');
});

test('an expired token is refreshed and the new session stored', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  const accessToken = createTokenProvider(h.deps);

  const token = await accessToken();
  assert.deepEqual(h.calls, ['r1']);
  assert.equal(token, h.state.accessToken);
  assert.equal(h.state.refreshToken, 'r2', 'rotated refresh token is persisted');
  assert.equal(expiresWithin(token!, 30), false);
});

test('concurrent callers share one refresh (the server revokes on rotation)', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  const accessToken = createTokenProvider(h.deps);

  const [a, b, c] = await Promise.all([accessToken(), accessToken(), accessToken()]);
  assert.deepEqual(h.calls, ['r1'], 'exactly one refresh call');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('a refresh rejected as UNAUTHORIZED clears the session and rejects instead of yielding a token', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  const accessToken = createTokenProvider({
    ...h.deps,
    refresh: async () => {
      throw Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } });
    },
  });

  await assert.rejects(() => accessToken());
  assert.equal(h.cleared(), 1);
  assert.equal(h.state.accessToken, null);
});

test('a network-shaped refresh failure does not clear the session and rejects instead of stranding', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  const accessToken = createTokenProvider({
    ...h.deps,
    refresh: async () => {
      throw new Error('fetch failed');
    },
  });

  await assert.rejects(() => accessToken());
  assert.equal(h.cleared(), 0, 'a transient failure must not erase a still-valid refresh token');
  assert.equal(h.state.refreshToken, 'r1', 'refresh token survives a transient failure');
});

test('an expired token with no refresh token clears instead of stranding', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: null });
  const accessToken = createTokenProvider(h.deps);

  assert.equal(await accessToken(), null);
  assert.equal(h.cleared(), 1);
});

test('a signed-out store asks for nothing and clears nothing', async () => {
  const h = harness({ accessToken: null, refreshToken: null });
  const accessToken = createTokenProvider(h.deps);

  assert.equal(await accessToken(), null);
  assert.deepEqual(h.calls, []);
  assert.equal(h.cleared(), 0);
});

test('a second refresh cycle on the same provider refreshes again instead of reusing the settled promise', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  const stillExpired = jwt(-60);
  let call = 0;
  const accessToken = createTokenProvider({
    ...h.deps,
    // the returned access token is itself already expired, so a correct provider must refresh again
    refresh: async (token: string) => {
      h.calls.push(token);
      call += 1;
      return session(stillExpired, `r${call + 1}`);
    },
  });

  const first = await accessToken();
  assert.equal(first, stillExpired);
  assert.deepEqual(h.calls, ['r1']);

  const second = await accessToken();
  assert.equal(second, stillExpired);
  assert.deepEqual(h.calls, ['r1', 'r2'], 'inFlight was reset, so the second call triggers a fresh refresh');
});

test('a provider recovers after a failed refresh once a fresh session is available', async () => {
  const h = harness({ accessToken: jwt(-60), refreshToken: 'r1' });
  let shouldFail = true;
  const accessToken = createTokenProvider({
    ...h.deps,
    refresh: async (token: string) => {
      h.calls.push(token);
      if (shouldFail) throw Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } });
      return session(jwt(900));
    },
  });

  await assert.rejects(() => accessToken(), 'the failed refresh rejects instead of yielding a token');
  assert.equal(h.cleared(), 1);
  assert.equal(h.state.accessToken, null);

  // simulate the user signing back in with a fresh session
  shouldFail = false;
  h.state.accessToken = jwt(-60);
  h.state.refreshToken = 'r2';

  const token = await accessToken();
  assert.equal(token, h.state.accessToken, 'inFlight was reset, so the rejected promise is not replayed');
  assert.deepEqual(h.calls, ['r1', 'r2']);
  assert.equal(h.cleared(), 1, 'no additional clear happened on the successful retry');
});

test('expiresWithin reads a real JWT payload: base64url, unpadded', () => {
  // What the API actually signs — `-`/`_` instead of `+`/`/`, and no `=` padding. Hermes rejected
  // unpadded input before React Native 0.74.1, so this shape is worth pinning.
  const base64url = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = (seconds: number) =>
    `header.${base64url({ sub: 'u1', email: 'ada@example.com', exp: Math.floor(Date.now() / 1000) + seconds })}.signature`;

  assert.equal(expiresWithin(token(900), 30), false);
  assert.equal(expiresWithin(token(-60), 30), true);
});
