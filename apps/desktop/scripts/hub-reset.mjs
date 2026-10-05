// Dev only. `hub-reset` forgets the hub's database connection (`hub.json`), so the setup screen shows
// again. `hub-reset all` also stops the bundled Postgres and deletes its data (`pg18`) and `pg.log`.
// Quit the app first: a running app would start the bundled cluster again on its next health poll.
// OS paths, not task inputs, so turbo has nothing to hash.
/* eslint-disable turbo/no-undeclared-env-vars */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
// The same binaries lookup and stop as the app (Node strips the types).
import { isInitialized, pgBinDir, stopPg } from '../src/main/pg.ts';

const all = process.argv.slice(2).some((arg) => arg === 'all' || arg === '--all');

// Electron's userData in dev: appData/<package name>.
const appData =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
const userData = join(appData, '@repo', 'desktop');

const remove = (path) => {
  if (!existsSync(path)) return console.log('absent ', path);
  rmSync(path, { recursive: true, force: true });
  console.log('removed', path);
};

remove(join(userData, 'hub.json'));

if (all) {
  // Same folder as hub.ts uses in dev; a packaged install keeps its data in %ProgramData% and is never touched.
  const dataDir = join(userData, 'pg18');
  const binDir = pgBinDir(process.platform, {
    packaged: false,
    resourcesPath: '',
    appPath: join(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  if (isInitialized(dataDir)) {
    if (binDir && existsSync(binDir)) {
      try {
        await stopPg({ binDir, dataDir, logPath: '' });
      } catch (error) {
        console.error(`pg_ctl stop failed (${error.message}); data left in place.`);
        process.exit(1);
      }
    } else if (existsSync(join(dataDir, 'postmaster.pid'))) {
      console.error(
        `No Postgres binaries at ${binDir}; stop the server on ${dataDir} first. Data left in place.`,
      );
      process.exit(1);
    }
  }
  remove(dataDir);
  remove(join(userData, 'logs', 'pg.log'));
}
