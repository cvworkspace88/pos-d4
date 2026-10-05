// index.ts shadows index.d.ts in the node program, so pull the Window typings in explicitly.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./index.d.ts" />
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { HubState } from '../main/hub-rules';

const API_URL_ARG = '--hub-api-url=';

const hub: Window['hub'] = {
  apiUrl:
    process.argv.find((arg) => arg.startsWith(API_URL_ARG))?.slice(API_URL_ARG.length) ??
    'http://127.0.0.1:3333',
  getState: () => ipcRenderer.invoke('hub:getState'),
  onState: (callback) => {
    const listener = (_: IpcRendererEvent, state: HubState) => callback(state);
    ipcRenderer.on('hub:state', listener);
    return () => ipcRenderer.off('hub:state', listener);
  },
  testDb: (db) => ipcRenderer.invoke('hub:testDb', db),
  saveDb: (db) => ipcRenderer.invoke('hub:saveDb', db),
  saveBundled: (input) => ipcRenderer.invoke('hub:saveBundled', input),
  restart: () => ipcRenderer.invoke('hub:restart'),
  openLog: () => ipcRenderer.invoke('hub:openLog'),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('hub', hub);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
  window.hub = hub;
}
