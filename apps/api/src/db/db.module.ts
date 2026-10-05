import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export type Database = NodePgDatabase<typeof schema>;
/** The transaction handle drizzle hands to the `transaction` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });
        // An idle client dying with the database must not kill the hub; queries still reject, so /health answers 503.
        pool.on('error', (error) => new Logger('Db').warn(error.message));
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
