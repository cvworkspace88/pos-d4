/** Pure pieces of the hub supervisor (US-002), kept free of Electron so `node --test` can import them. */

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}
export type PublicDb = Omit<DbConfig, 'password'>;

/** `bundled`: the Postgres shipped in `resources/pg`, run by main. `external`: Docker or a manual install. */
export type DbMode = 'bundled' | 'external';

/** The bundled form: host and database are fixed (127.0.0.1, `pos_hub`). */
export interface BundledInput {
  port: number;
  user: string;
  password: string;
}

export type HubState =
  | { status: 'starting' }
  /**
   * `bundled`: this build ships Postgres binaries for this platform, so the bundled form is offered.
   * `cluster`: a bundled cluster already exists on this PC (reinstall, lost `hub.json`), so the form asks
   * for its original user and password instead of generating new ones.
   */
  | { status: 'setup'; bundled: boolean; cluster: boolean; mode?: DbMode; db?: PublicDb; error?: string }
  | { status: 'ready' }
  /** `logPath`: the bundled database's `pg.log`; absent for an external database. */
  | { status: 'db-down'; logPath?: string }
  | { status: 'crashed'; logPath: string };

export type TestResult = { ok: true } | { ok: false; message: string };

export const DEFAULT_DB: PublicDb = { host: '127.0.0.1', port: 5432, database: 'pos_hub', user: 'postgres' };
export const DEFAULT_API_PORT = 3333;
/** Not 5432, so an existing Postgres on the PC does not collide with the bundled one. */
export const BUNDLED_PORT = 5433;
export const BUNDLED_DATABASE = 'pos_hub';

const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_RESTARTS = 3;

/**
 * `crashTimes` includes the crash that just happened. A sliding window rather than "3 per run", so a till
 * left on for days is not blocked by unrelated crashes a week apart.
 */
export function shouldRestart(crashTimes: number[], now: number): boolean {
  return crashTimes.filter((t) => now - t < CRASH_WINDOW_MS).length <= MAX_RESTARTS;
}

const UNREACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH']);

/** Every message says what to check next; the setup screen shows it verbatim. */
export function dbErrorMessage(error: unknown, db: PublicDb): string {
  const e = error as { code?: string; message?: string; errors?: { code?: string }[] };
  // Node reports a failed dual-stack connect as an AggregateError; the socket code is on its parts.
  const code = e?.code ?? e?.errors?.[0]?.code;
  // pg's connect timeout is a plain Error('timeout expired') with no code.
  if ((code && UNREACHABLE.has(code)) || (!code && /timeout/i.test(e?.message ?? '')))
    return `Tidak bisa terhubung ke ${db.host}:${db.port}. Pastikan Docker Desktop atau layanan PostgreSQL berjalan.`;
  if (code === '28P01' || code === '28000') return 'User atau password salah.';
  if (code === '3D000') return `Database ${db.database} belum ada. Buat dulu (lihat panduan instalasi).`;
  return `${e?.message ?? String(error)}. Periksa pengaturan database.`;
}

export function databaseUrl(db: DbConfig): string {
  const enc = encodeURIComponent;
  return `postgresql://${enc(db.user)}:${enc(db.password)}@${db.host}:${db.port}/${enc(db.database)}`;
}

export function publicDb({ host, port, database, user }: DbConfig): PublicDb {
  return { host, port, database, user };
}
