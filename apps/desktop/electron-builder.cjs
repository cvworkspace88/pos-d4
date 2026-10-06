// electron-builder has no env macros for `appId`, so the config is JS: it reads the same .env as the main
// process, keeping `appId` and the Windows AppUserModelId (`MAIN_VITE_APP_ID`, src/main/index.ts) equal.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const envFile = join(__dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: process.env.MAIN_VITE_APP_ID ?? 'com.inovtech.pos',
  productName: 'POS D4',
  directories: { buildResources: 'build' },
  files: ['out/**', 'package.json'],
  // Bundled PostgreSQL (US-002): this platform's EDB binaries, outside the asar so they can run.
  // `resources/pg` is gitignored; copy the binaries there before packaging.
  mac: { target: 'dmg', extraResources: [{ from: 'resources/pg/mac', to: 'pg' }] },
  win: { target: 'nsis', extraResources: [{ from: 'resources/pg/win-x64', to: 'pg' }] },
  linux: { target: 'AppImage' },
};
