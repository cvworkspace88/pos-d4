import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseUrl, dbErrorMessage, publicDb, shouldRestart, type DbConfig } from './hub-rules.ts';

const MIN = 60_000;
const db: DbConfig = { host: '127.0.0.1', port: 5432, database: 'pos_hub', user: 'postgres', password: 'x' };

test('shouldRestart allows three crashes in ten minutes and stops at the fourth', () => {
  const now = 100 * MIN;
  assert.equal(shouldRestart([now], now), true);
  assert.equal(shouldRestart([now - 2 * MIN, now - MIN, now], now), true);
  assert.equal(shouldRestart([now - 3 * MIN, now - 2 * MIN, now - MIN, now], now), false);
});

test('shouldRestart forgets crashes older than ten minutes', () => {
  const now = 100 * MIN;
  assert.equal(shouldRestart([now - 30 * MIN, now - 20 * MIN, now - 11 * MIN, now], now), true);
});

test('dbErrorMessage says what to check for an unreachable server', () => {
  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH']) {
    assert.equal(
      dbErrorMessage({ code }, db),
      'Tidak bisa terhubung ke 127.0.0.1:5432. Pastikan Docker Desktop atau layanan PostgreSQL berjalan.',
    );
  }
});

test('dbErrorMessage treats pg connect timeout (no code) as unreachable', () => {
  assert.equal(
    dbErrorMessage(new Error('timeout expired'), db),
    'Tidak bisa terhubung ke 127.0.0.1:5432. Pastikan Docker Desktop atau layanan PostgreSQL berjalan.',
  );
});

test('dbErrorMessage reads the code off an AggregateError (dual-stack connect)', () => {
  const error = Object.assign(new AggregateError([{ code: 'ECONNREFUSED' }]), {});
  assert.match(dbErrorMessage(error, db), /^Tidak bisa terhubung/);
});

test('dbErrorMessage maps credentials, missing database and the fallback', () => {
  assert.equal(dbErrorMessage({ code: '28P01' }, db), 'User atau password salah.');
  assert.equal(dbErrorMessage({ code: '28000' }, db), 'User atau password salah.');
  assert.equal(
    dbErrorMessage({ code: '3D000' }, db),
    'Database pos_hub belum ada. Buat dulu (lihat panduan instalasi).',
  );
  assert.equal(dbErrorMessage(new Error('boom'), db), 'boom. Periksa pengaturan database.');
});

test('databaseUrl escapes a password with URL metacharacters', () => {
  const url = new URL(databaseUrl({ ...db, user: 'pos user', password: 'p@ss:w/rd%1' }));
  assert.equal(decodeURIComponent(url.password), 'p@ss:w/rd%1');
  assert.equal(decodeURIComponent(url.username), 'pos user');
  assert.equal(url.host, '127.0.0.1:5432');
  assert.equal(url.pathname, '/pos_hub');
});

test('publicDb drops the password', () => {
  assert.deepEqual(publicDb(db), { host: '127.0.0.1', port: 5432, database: 'pos_hub', user: 'postgres' });
});
