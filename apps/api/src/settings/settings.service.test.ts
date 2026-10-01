import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { settings } from '../db/schema';
import { connectTestDatabase, type TestDatabase } from '../test/test-db';
import { SettingsService } from './settings.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: SettingsService;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new SettingsService(db);
});

afterAll(async () => {
  await close();
});

// `truncateAll` leaves the settings row alone, so this file clears it itself.
beforeEach(async () => {
  await db.delete(settings);
});

test('a fresh deployment reads the defaults: 120s idle, desktop lock off', async () => {
  expect(await service.get()).toEqual({ idleTimeoutSeconds: 120, desktopLockSeconds: 0 });
});

test('saving one setting leaves the other alone', async () => {
  await service.update({ idleTimeoutSeconds: 300 });
  expect(await service.update({ desktopLockSeconds: 600 })).toEqual({
    idleTimeoutSeconds: 300,
    desktopLockSeconds: 600,
  });
});

test('the database refuses a desktop lock over an hour', async () => {
  await expect(service.update({ desktopLockSeconds: 3601 })).rejects.toThrow();
});
