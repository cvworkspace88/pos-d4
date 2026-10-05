import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { Client } from 'pg';
import { loadHubConfig, saveHubConfig, type HubConfig } from './hub-config';
import {
  BUNDLED_DATABASE,
  DEFAULT_API_PORT,
  databaseUrl,
  dbErrorMessage,
  publicDb,
  shouldRestart,
  type BundledInput,
  type DbConfig,
  type HubState,
  type TestResult,
} from './hub-rules';
import {
  ensureDatabase,
  initCluster,
  isInitialized,
  pgBinDir,
  portFree,
  runningPort,
  startPg,
  stopPg,
  type PgPaths,
} from './pg';

const DB_RETRY_MS = 5_000;
const BOOT_POLL_MS = 500;
const BOOT_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_000;

// ponytail: monorepo path; the packaging story points this at the API shipped in the installer.
const apiEntry = () => join(app.getAppPath(), '../api/dist/main.js');

/** Null when this build has no Postgres binaries for this platform (a fresh clone, Linux). */
function bundledPaths(logPath: string): PgPaths | null {
  const binDir = pgBinDir(process.platform, {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!binDir || !existsSync(binDir)) return null;
  // Packaged on Windows: machine-wide and outside the install folder, so updates and uninstall keep the
  // data. Dev (any OS): userData, so a dev run never touches an installed till's database.
  const dataDir =
    app.isPackaged && process.platform === 'win32'
      ? join(process.env.ProgramData ?? 'C:\\ProgramData', 'POS D4', 'pg18')
      : join(app.getPath('userData'), 'pg18');
  return { binDir, dataDir, logPath };
}

export async function testDb(db: DbConfig): Promise<TestResult> {
  const client = new Client({ ...db, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: dbErrorMessage(error, db) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Runs the local API for this desktop (US-002): probe the database, fork the API, wait for health,
 * watch it, restart it on a crash. `run` is bumped by every restart/save/stop so a probe or poll that
 * resolves late from an earlier attempt drops its result instead of acting on it.
 */
export class Hub {
  readonly logPath = join(app.getPath('userData'), 'logs', 'api.log');
  private readonly pg = bundledPaths(join(app.getPath('userData'), 'logs', 'pg.log'));
  /** One `pg_ctl start` at a time: the db-down poll and a reconnect can both ask for one. */
  private pgStart: Promise<TestResult> | null = null;
  private readonly external = process.env.DESKTOP_EXTERNAL_API === '1';
  private config: HubConfig | null = loadHubConfig();
  private state: HubState = { status: 'starting' };
  private child: UtilityProcess | null = null;
  private crashes: number[] = [];
  private timer: NodeJS.Timeout | undefined;
  private run = 0;
  private stopping = false;
  /** Pending exit of the child being stopped: a second restart waits for it instead of forking over it. */
  private exiting: Promise<void> = Promise.resolve();
  private log: WriteStream | null = null;

  constructor(private readonly onState: (state: HubState) => void) {}

  get apiUrl(): string {
    return `http://127.0.0.1:${this.config?.apiPort ?? DEFAULT_API_PORT}`;
  }

  getState(): HubState {
    return this.state;
  }

  start(): void {
    // Dev escape hatch: something else (`pnpm api:dev` with DEPLOYMENT=local) already serves the port.
    if (this.external) return this.set({ status: 'ready' });
    void this.connect(this.run);
  }

  async saveDb(db: DbConfig): Promise<TestResult> {
    if (this.stopping) return { ok: false, message: 'Aplikasi sedang ditutup.' };
    // Pause the retry loop of the old config so it cannot fork (and migrate) the old database mid-save.
    const run = ++this.run;
    clearTimeout(this.timer);
    const result = await testDb(db);
    if (!result.ok) {
      if (run === this.run) void this.connect(run);
      return result;
    }
    this.config = saveHubConfig('external', db, this.config);
    await this.restart();
    return result;
  }

  /** "Database bawaan": initdb (skipped when a cluster exists), start, create `pos_hub`, save, connect. */
  async saveBundled(input: BundledInput): Promise<TestResult> {
    if (this.stopping) return { ok: false, message: 'Aplikasi sedang ditutup.' };
    const db: DbConfig = { ...input, host: '127.0.0.1', database: BUNDLED_DATABASE };
    // Pause the retry loop of a failing saved config so it cannot start the cluster mid-setup.
    const run = ++this.run;
    clearTimeout(this.timer);
    const result = await this.setUpBundled(db);
    if (!result.ok) {
      if (run === this.run) void this.connect(run);
      return result;
    }
    this.config = saveHubConfig('bundled', db, this.config);
    await this.restart();
    return result;
  }

  /** "Mulai ulang", and every save: forget the crash history and start over from the DB probe. */
  async restart(): Promise<void> {
    if (this.stopping) return;
    const run = ++this.run;
    clearTimeout(this.timer);
    this.crashes = [];
    await this.stopChild();
    if (run === this.run) void this.connect(run);
  }

  /** App quit. In-flight transactions roll back in Postgres; nothing half-written remains. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.run++;
    clearTimeout(this.timer);
    await this.stopChild();
    // A `pg_ctl start` still in flight would bring Postgres up after the stop below and orphan it.
    await this.pgStart;
    // The API is down, so nothing writes any more. Runs in external mode too: the cluster may still be up
    // from an earlier bundled choice.
    if (this.pg) await stopPg(this.pg).catch((error) => console.error('pg stop', error));
    this.log?.end();
  }

  private set(state: HubState): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    this.onState(state);
  }

  private async connect(run: number): Promise<void> {
    if (this.stopping) return;
    if (!this.config) return this.set(this.setupState());
    const config = this.config;
    const result =
      config.mode === 'bundled' ? await this.startBundled(config.db.port) : { ok: true as const };
    const probed = result.ok ? await testDb(config.db) : result;
    if (run !== this.run) return;
    if (!probed.ok) {
      this.set(this.setupState({ mode: config.mode, db: publicDb(config.db), error: probed.message }));
      // Docker Desktop is often still starting when the PC boots.
      this.timer = setTimeout(() => void this.connect(run), DB_RETRY_MS);
      return;
    }
    this.spawn(run, config);
  }

  private setupState(extra: Partial<Extract<HubState, { status: 'setup' }>> = {}): HubState {
    const cluster = this.pg !== null && isInitialized(this.pg.dataDir);
    return { status: 'setup', bundled: this.pg !== null, cluster, ...extra };
  }

  private async setUpBundled(db: DbConfig): Promise<TestResult> {
    const pg = this.pg;
    if (!pg)
      return {
        ok: false,
        message: 'Database bawaan tidak tersedia di instalasi ini. Pilih "Database eksternal".',
      };
    let existed = false;
    try {
      // A start from the connect loop may still be in flight; until it settles, our own postgres looks
      // like another program on the port.
      await this.pgStart;
      // Our own cluster already on this port holds it itself; on another port, startPg moves it.
      if ((await runningPort(pg)) !== db.port && !(await portFree(db.port)))
        return { ok: false, message: `Port ${db.port} sudah dipakai program lain. Pilih port lain.` };
      existed = !(await initCluster(pg, db.user, db.password));
      await startPg(pg, db.port);
      await ensureDatabase(db);
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: string }).code;
      // The cluster keeps the credentials it was created with; a new password cannot open it.
      if (existed && (code === '28P01' || code === '28000'))
        return {
          ok: false,
          message:
            'User atau password tidak cocok dengan database bawaan yang sudah ada di komputer ini. Isi user dan password yang dipakai saat pertama kali disiapkan, atau hubungi dukungan teknis.',
        };
      return { ok: false, message: `${dbErrorMessage(error, db)} Log: ${pg.logPath}` };
    }
  }

  private startBundled(port: number): Promise<TestResult> {
    const pg = this.pg;
    if (!pg)
      return Promise.resolve({
        ok: false,
        message: 'Database bawaan tidak ditemukan di instalasi ini. Instal ulang aplikasi.',
      });
    this.pgStart ??= startPg(pg, port)
      .then((): TestResult => ({ ok: true }))
      .catch((error: Error) => ({
        ok: false,
        message: `Database bawaan tidak bisa dimulai: ${error.message} Log: ${pg.logPath}`,
      }))
      .finally(() => (this.pgStart = null));
    return this.pgStart;
  }

  private spawn(run: number, config: HubConfig): void {
    this.set({ status: 'starting' });
    mkdirSync(dirname(this.logPath), { recursive: true });
    if (!this.log) {
      this.log = createWriteStream(this.logPath, { flags: 'a' });
      this.log.on('error', (error) => console.error('api.log', error));
    }
    this.log.write(`\n--- ${new Date().toISOString()} API start ---\n`);

    const child = utilityProcess.fork(apiEntry(), [], {
      serviceName: 'pos-api',
      // userData has no .env, so the dev `apps/api/.env` never leaks into the hub.
      cwd: app.getPath('userData'),
      stdio: 'pipe',
      env: {
        ...process.env,
        DEPLOYMENT: 'local',
        DATABASE_URL: databaseUrl(config.db),
        JWT_ACCESS_SECRET: config.jwtSecret,
        PORT: String(config.apiPort),
        API_HOST: '0.0.0.0',
      },
    });
    child.stdout?.pipe(this.log, { end: false });
    child.stderr?.pipe(this.log, { end: false });
    child.on('exit', (code) => this.onExit(child, code));
    this.child = child;
    void this.waitForHealth(run);
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (child !== this.child) return; // stopped on purpose
    this.child = null;
    clearTimeout(this.timer);
    this.log?.write(`--- ${new Date().toISOString()} API exited with code ${code} ---\n`);
    if (this.stopping) return;
    const now = Date.now();
    this.crashes.push(now);
    if (!shouldRestart(this.crashes, now)) return this.set({ status: 'crashed', logPath: this.logPath });
    this.set({ status: 'starting' });
    void this.connect(++this.run);
  }

  private async waitForHealth(run: number): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (run === this.run && this.child) {
      if ((await this.health()) === 200) {
        if (run !== this.run) return;
        this.set({ status: 'ready' });
        return this.watch(run);
      }
      if (run !== this.run) return;
      // Killing it fires `exit`, which counts the timeout as a crash.
      if (Date.now() > deadline) return void this.child?.kill();
      await sleep(BOOT_POLL_MS);
    }
  }

  private watch(run: number): void {
    this.timer = setTimeout(async () => {
      const status = await this.health();
      if (run !== this.run || !this.child) return;
      const bundled = this.config?.mode === 'bundled';
      // A bundled cluster that died is started again; startPg is a no-op while it runs.
      if (status !== 200 && bundled && this.config) void this.startBundled(this.config.db.port);
      // ponytail: a dead socket while the process lives reads as db-down; a hung API is not a crash.
      this.set(
        status === 200
          ? { status: 'ready' }
          : { status: 'db-down', logPath: bundled ? this.pg?.logPath : undefined },
      );
      this.watch(run);
    }, READY_POLL_MS);
  }

  /** 200 only from our own child: a second app or `pnpm api:dev` holding the port must not read as healthy. */
  private async health(): Promise<number | null> {
    try {
      const res = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (res.status !== 200) return res.status;
      const body = (await res.json()) as { pid?: number };
      return body.pid !== undefined && body.pid === this.child?.pid ? 200 : null;
    } catch {
      return null;
    }
  }

  /** Resolves once the child has exited (or after 5 s). Clearing `child` first makes `onExit` ignore it. */
  private stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return this.exiting;
    this.exiting = new Promise((resolve) => {
      const timeout = setTimeout(resolve, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill();
    });
    return this.exiting;
  }
}
