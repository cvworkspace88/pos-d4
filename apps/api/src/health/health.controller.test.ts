import { ServiceUnavailableException } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module';
import { connectTestDatabase } from '../test/test-db';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let close: (() => Promise<void>) | undefined;
  afterAll(() => close?.());

  it('answers ok when the database answers', async () => {
    const test = await connectTestDatabase();
    close = test.close;
    await expect(new HealthController(test.db as unknown as Database).check()).resolves.toEqual({
      ok: true,
      pid: process.pid,
    });
  });

  it('answers 503 when the database does not', async () => {
    const down = { execute: () => Promise.reject(new Error('ECONNREFUSED')) } as unknown as Database;
    await expect(new HealthController(down).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
