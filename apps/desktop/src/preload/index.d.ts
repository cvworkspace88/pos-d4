import type { ElectronAPI } from '@electron-toolkit/preload';
import type { BundledInput, DbConfig, HubState, TestResult } from '../main/hub-rules';

/** The hub supervisor in Electron main (US-002), bridged by the preload. */
interface HubApi {
  apiUrl: string;
  getState(): Promise<HubState>;
  /** Returns the unsubscribe function. */
  onState(callback: (state: HubState) => void): () => void;
  testDb(db: DbConfig): Promise<TestResult>;
  saveDb(db: DbConfig): Promise<TestResult>;
  /** First run of the bundled database: initdb, start, create `pos_hub`, then connect. */
  saveBundled(input: BundledInput): Promise<TestResult>;
  restart(): Promise<void>;
  /** Resolves to '' on success, otherwise the OS error text (shell.openPath). */
  openLog(): Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    hub: HubApi;
  }
}

export {};
