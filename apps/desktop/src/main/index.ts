import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { Hub, testDb } from './hub';
import type { BundledInput, DbConfig, HubState } from './hub-rules';

let hub: Hub | undefined;

// One hub per PC: a second launch would fork a second API on the same port and, on quit, stop the first
// one's database. A second launch focuses the existing window instead.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function createWindow(apiUrl: string): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Read once by the preload: the tRPC client is built at import time.
      additionalArguments: [`--hub-api-url=${apiUrl}`],
    },
  });

  window.on('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  if (!primary) return;
  // Baked in at build time from apps/desktop/.env (electron-vite exposes MAIN_VITE_* to main); electron-builder.cjs
  // reads the same variable for `appId`, so the two stay equal.
  electronApp.setAppUserModelId(import.meta.env.MAIN_VITE_APP_ID ?? 'com.inovtech.pos');
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window));

  // Created after `ready`: safeStorage cannot decrypt hub.json before it.
  const current = new Hub((state: HubState) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('hub:state', state);
  });
  hub = current;
  ipcMain.handle('hub:getState', () => current.getState());
  ipcMain.handle('hub:testDb', (_, db: DbConfig) => testDb(db));
  ipcMain.handle('hub:saveDb', (_, db: DbConfig) => current.saveDb(db));
  ipcMain.handle('hub:saveBundled', (_, input: BundledInput) => current.saveBundled(input));
  ipcMain.handle('hub:restart', () => current.restart());
  ipcMain.handle('hub:openLog', () => shell.openPath(current.logPath));

  createWindow(current.apiUrl);
  current.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(current.apiUrl);
  });
});

// Stop the API before quitting so nothing is left listening on the port.
let stopped = false;
app.on('before-quit', (event) => {
  if (stopped || !hub) return;
  event.preventDefault();
  void hub.stop().finally(() => {
    stopped = true;
    // Out of this dispatch: with nothing to stop (external API) the promise settles before Electron's own
    // `before-quit` call returns, and a nested quit would then be reset as cancelled, leaving a windowless
    // process on macOS that holds the single-instance lock.
    setImmediate(() => app.quit());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
