import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { BUNDLED_DATABASE } from './hub-rules.ts';
import {
  ensureDatabase,
  initCluster,
  initdbArgs,
  isRunning,
  pgBinDir,
  pgCtlStartArgs,
  portFree,
  runningPort,
  startPg,
  stopPg,
} from './pg.ts';

test('pgBinDir: packaged reads resources/pg, dev picks the platform folder', () => {
  const where = { resourcesPath: '/app/resources', appPath: '/repo/apps/desktop' };
  assert.equal(pgBinDir('win32', { ...where, packaged: true }), join('/app/resources', 'pg', 'bin'));
  assert.equal(
    pgBinDir('win32', { ...where, packaged: false }),
    join('/repo/apps/desktop', 'resources', 'pg', 'win-x64', 'bin'),
  );
  assert.equal(
    pgBinDir('darwin', { ...where, packaged: false }),
    join('/repo/apps/desktop', 'resources', 'pg', 'mac', 'bin'),
  );
  assert.equal(pgBinDir('linux', { ...where, packaged: false }), null);
});

test('initdbArgs: scram, UTF-8, builtin locale, password from a file', () => {
  assert.deepEqual(initdbArgs('/data', 'pos', '/tmp/pw'), [
    '-D',
    '/data',
    '-U',
    'pos',
    '--pwfile=/tmp/pw',
    '--auth=scram-sha-256',
    '-E',
    'UTF8',
    '--locale-provider=builtin',
    '--builtin-locale=C.UTF-8',
  ]);
});

test('pgCtlStartArgs: waits, logs to the file, listens on loopback only', () => {
  assert.deepEqual(pgCtlStartArgs({ dataDir: '/data', logPath: '/logs/pg.log' }, 5433), [
    'start',
    '-w',
    '-t',
    '60',
    '-D',
    '/data',
    '-l',
    '/logs/pg.log',
    '-o',
    '-p 5433 -c listen_addresses=127.0.0.1',
  ]);
});

const binDir = pgBinDir(process.platform, {
  packaged: false,
  resourcesPath: '',
  appPath: join(import.meta.dirname, '../..'),
});

// Runs the real binaries when `resources/pg` has them for this platform (gitignored, so not on a fresh clone).
test(
  'bundled cluster: init, start, create database, restart-safe, stop',
  { skip: !binDir || !existsSync(binDir) },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'pos-pg-test-'));
    const paths = { binDir: binDir!, dataDir: join(root, 'pg18'), logPath: join(root, 'logs', 'pg.log') };
    const port = 54_000 + Math.floor(Math.random() * 1000);
    const db = { host: '127.0.0.1', port, database: BUNDLED_DATABASE, user: 'pos', password: 'p@ss:w/rd' };
    try {
      assert.equal(await portFree(port), true);
      assert.equal(await initCluster(paths, db.user, db.password), true);
      assert.equal(await initCluster(paths, db.user, db.password), false, 'an existing cluster is reused');

      await startPg(paths, port);
      await startPg(paths, port); // already running is not an error
      assert.equal(await isRunning(paths), true);
      assert.equal(await portFree(port), false);

      await ensureDatabase(db);
      await ensureDatabase(db); // idempotent
      const client = new pg.Client(db);
      await client.connect();
      const { rows } = await client.query<{ setting: string }>(
        `select current_setting('listen_addresses') as setting`,
      );
      await client.end();
      assert.equal(rows[0]?.setting, '127.0.0.1');

      // A cluster left running on another port is restarted on the one asked for.
      const other = port + 1;
      assert.equal(await runningPort(paths), port);
      await startPg(paths, other);
      assert.equal(await runningPort(paths), other);
      assert.equal(await portFree(port), true);

      await stopPg(paths);
      assert.equal(await isRunning(paths), false);
      assert.equal(await runningPort(paths), null);
      await stopPg(paths); // stopped is not an error
    } finally {
      await stopPg(paths).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('initCluster refuses a password with a line break (initdb reads only the first line)', async () => {
  await assert.rejects(
    initCluster({ binDir: '/nope', dataDir: join(tmpdir(), 'never'), logPath: '' }, 'pos', 'a\nb'),
    /baris baru/,
  );
});
