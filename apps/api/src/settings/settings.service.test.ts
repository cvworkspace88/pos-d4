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

test('a fresh deployment reads the defaults: 120s idle, PPN 11% effective', async () => {
  expect(await service.get()).toEqual({ idleTimeoutSeconds: 120, ppnRateBp: 1100 });
});

test('saving the PPN rate leaves the idle timeout alone, and the other way round', async () => {
  await service.update({ idleTimeoutSeconds: 300 });
  expect(await service.update({ ppnRateBp: 1200 })).toEqual({ idleTimeoutSeconds: 300, ppnRateBp: 1200 });
  expect(await service.update({ idleTimeoutSeconds: 60 })).toEqual({
    idleTimeoutSeconds: 60,
    ppnRateBp: 1200,
  });
});

test('the database refuses a PPN rate over 100%', async () => {
  await expect(service.update({ ppnRateBp: 10001 })).rejects.toThrow();
});
