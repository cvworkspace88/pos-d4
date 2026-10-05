import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { DEFAULT_API_PORT, publicDb, type DbConfig, type DbMode, type PublicDb } from './hub-rules';

/** `userData/hub.json`. Secrets are `safeStorage` ciphertext (DPAPI on Windows), tied to the OS user. */
interface HubFile {
  /** Missing in files written before bundled mode (2026-10-05): those are external. */
  mode?: DbMode;
  db: PublicDb & { passwordEnc: string };
  apiPort: number;
  jwtSecretEnc: string;
}

export interface HubConfig {
  mode: DbMode;
  db: DbConfig;
  apiPort: number;
  jwtSecret: string;
}

const file = () => join(app.getPath('userData'), 'hub.json');
const encrypt = (value: string) => safeStorage.encryptString(value).toString('base64');
const decrypt = (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64'));

/**
 * Null on first run — and on a file that cannot be read back (corrupt, or encrypted by another OS user):
 * the setup screen then asks again, which is the only recovery anyway.
 */
export function loadHubConfig(): HubConfig | null {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as HubFile;
    const { passwordEnc, ...db } = raw.db;
    return {
      mode: raw.mode ?? 'external',
      db: { ...db, password: decrypt(passwordEnc) },
      apiPort: raw.apiPort ?? DEFAULT_API_PORT,
      jwtSecret: decrypt(raw.jwtSecretEnc),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('hub.json unreadable', error);
    return null;
  }
}

/** Keeps `apiPort` and the JWT secret across saves: a new secret would invalidate every access token. */
export function saveHubConfig(mode: DbMode, db: DbConfig, previous: HubConfig | null): HubConfig {
  const config: HubConfig = {
    mode,
    db,
    apiPort: previous?.apiPort ?? DEFAULT_API_PORT,
    jwtSecret: previous?.jwtSecret ?? randomBytes(32).toString('base64url'),
  };
  const out: HubFile = {
    mode,
    db: { ...publicDb(db), passwordEnc: encrypt(db.password) },
    apiPort: config.apiPort,
    jwtSecretEnc: encrypt(config.jwtSecret),
  };
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(out, null, 2));
  return config;
}
