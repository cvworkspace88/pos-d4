import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';

/**
 * Probe for the desktop's hub supervisor (US-002): 200 once the database answers, 503 while it does not.
 * `pid` lets the supervisor tell its own API from another server that happens to hold the port.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database tidak terhubung.');
    }
    return { ok: true, pid: process.pid };
  }
}
