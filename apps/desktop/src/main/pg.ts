import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import pg from 'pg';
import type { DbConfig } from './hub-rules';

/**
 * Bundled PostgreSQL (US-002): the EDB binaries in `resources/pg`, run by Electron main as a private
 * instance — `pg_ctl`, not a Windows service. Electron-free (paths come in) so `node --test` runs it
 * against the real binaries.
 */

export interface PgPaths {
  binDir: string;
  dataDir: string;
  logPath: string;
}

const PLATFORM_DIR: Partial<Record<NodeJS.Platform, string>> = { win32: 'win-x64', darwin: 'mac' };

/** Packaged: `extraResources` puts this platform's folder at `resources/pg`. Dev: `resources/pg/<platform>`. */
export function pgBinDir(
  platform: NodeJS.Platform,
  where: { packaged: boolean; resourcesPath: string; appPath: string },
): string | null {
  if (where.packaged) return join(where.resourcesPath, 'pg', 'bin');
  const dir = PLATFORM_DIR[platform];
  return dir ? join(where.appPath, 'resources', 'pg', dir, 'bin') : null;
}

export function initdbArgs(dataDir: string, user: string, pwFile: string): string[] {
  return [
    '-D',
    dataDir,
    '-U',
    user,
    `--pwfile=${pwFile}`,
    '--auth=scram-sha-256',
    '-E',
    'UTF8',
    // Builtin provider: same collation on every till, no dependency on the OS's ICU or locales.
    '--locale-provider=builtin',
    '--builtin-locale=C.UTF-8',
  ];
}

export function pgCtlStartArgs(paths: Pick<PgPaths, 'dataDir' | 'logPath'>, port: number): string[] {
  // Loopback only: tablets reach the API, never Postgres.
  return [
    'start',
    '-w',
    '-t',
    '60',
    '-D',
    paths.dataDir,
    '-l',
    paths.logPath,
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1`,
  ];
}

const exe = (binDir: string, name: string) =>
  join(binDir, process.platform === 'win32' ? `${name}.exe` : name);

/**
 * Settles on `exit`, not `close`: the postgres that `pg_ctl start` leaves running could hold inherited
 * pipes open forever. `windowsHide` keeps a console window from flashing on the till.
 */
function run(file: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output: output.trim() }));
  });
}

async function runOk(file: string, args: string[]): Promise<void> {
  const { code, output } = await run(file, args);
  if (code !== 0) throw new Error(output || `${basename(file)} exited with code ${code}`);
}

export const isInitialized = (dataDir: string) => existsSync(join(dataDir, 'PG_VERSION'));

/**
 * First run only. Returns false when the data dir already holds a cluster: a reinstall or update keeps
 * the data, never re-initialises it. The password reaches initdb through a temp file in the user's
 * temp dir, never on the command line, and the file is gone before this returns.
 */
export async function initCluster(paths: PgPaths, user: string, password: string): Promise<boolean> {
  if (/[\r\n]/.test(password)) throw new Error('Password tidak boleh berisi baris baru.');
  if (isInitialized(paths.dataDir)) return false;
  mkdirSync(dirname(paths.dataDir), { recursive: true });
  const pwFile = join(tmpdir(), `pos-initdb-${process.pid}-${Date.now()}`);
  writeFileSync(pwFile, `${password}\n`, { mode: 0o600 });
  try {
    await runOk(exe(paths.binDir, 'initdb'), initdbArgs(paths.dataDir, user, pwFile));
  } finally {
    rmSync(pwFile, { force: true });
  }
  return true;
}

/** `pg_ctl status` exits 0 only while a server runs on this data dir. */
export async function isRunning(paths: PgPaths): Promise<boolean> {
  if (!isInitialized(paths.dataDir)) return false;
  return (await run(exe(paths.binDir, 'pg_ctl'), ['status', '-D', paths.dataDir])).code === 0;
}

/** The port a running cluster listens on (line 4 of `postmaster.pid`), or null when it is not running. */
export async function runningPort(paths: PgPaths): Promise<number | null> {
  if (!(await isRunning(paths))) return null;
  try {
    const port = Number(readFileSync(join(paths.dataDir, 'postmaster.pid'), 'utf8').split('\n')[3]);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null; // stopped between the status check and the read
  }
}

/**
 * Already running on `port` (left over from a crash, or Ctrl+C in dev) is not an error. Running on another
 * port (the setting changed) is restarted on this one.
 */
export async function startPg(paths: PgPaths, port: number): Promise<void> {
  const current = await runningPort(paths);
  if (current === port) return;
  if (current !== null) await stopPg(paths);
  mkdirSync(dirname(paths.logPath), { recursive: true });
  await runOk(exe(paths.binDir, 'pg_ctl'), pgCtlStartArgs(paths, port));
}

/** Quit, after the API has stopped. `fast` rolls back open transactions instead of waiting for them. */
export async function stopPg(paths: PgPaths): Promise<void> {
  if (!(await isRunning(paths))) return;
  await runOk(exe(paths.binDir, 'pg_ctl'), ['stop', '-m', 'fast', '-w', '-D', paths.dataDir]);
}

/** Creates `db.database` on first run; the API then migrates it on boot. */
export async function ensureDatabase(db: DbConfig): Promise<void> {
  const client = new pg.Client({ ...db, database: 'postgres', connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [db.database]);
    if (!rowCount) await client.query(`create database ${client.escapeIdentifier(db.database)}`);
  } finally {
    await client.end();
  }
}

/** True when nothing listens on 127.0.0.1:port — checked before initdb so a taken port fails with a clear message. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
