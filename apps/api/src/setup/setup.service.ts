import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { DRIZZLE, type Database } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { outlets, roles, users } from '../db/schema';
import { normalizeCode } from '../outlet/outlet-rules';
import type { Timezone } from '../outlet/outlet.service';

/** What the desktop's first-run form sends (US-088). */
export interface SetupInput {
  outlet: {
    name: string;
    code: string;
    address?: string;
    timezone: Timezone;
    /** Local `HH:mm`. */
    businessDayCutoff: string;
  };
  owner: { name: string; username: string; password: string; pin: string };
}

@Injectable()
export class SetupService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Set up = any outlet row, closed ones included: a deactivated last outlet is not a fresh install,
   * and reopening the wizard there would hand out a second owner account.
   */
  async status(): Promise<{ needed: boolean }> {
    const [row] = await this.db.select({ id: outlets.id }).from(outlets).limit(1);
    return { needed: !row };
  }

  /** The first outlet and its global owner, together or not at all. Refused once any outlet exists. */
  async run(input: SetupInput): Promise<void> {
    // Hashed before the transaction: argon2 is deliberately slow, and the lock should not wait on it.
    const [passwordHash, pinHash] = await Promise.all([
      argon2.hash(input.owner.password),
      argon2.hash(input.owner.pin),
    ]);

    await this.db.transaction(async (tx) => {
      // A double submit (or two windows) waits here for the first, then finds its outlet below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pos.setup'))`);
      const [existing] = await tx.select({ id: outlets.id }).from(outlets).limit(1);
      if (existing)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Outlet sudah disiapkan. Masuk dengan akun pemilik.',
        });

      // Seeded on every hub start (`migrateDatabase`), so missing means a broken install, not user error.
      const [ownerRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.name, 'owner'));
      if (!ownerRole) throw new Error('owner role missing: seedRbac did not run');

      const owner = await tx
        .insert(users)
        .values({
          name: input.owner.name,
          username: input.owner.username.toLowerCase(),
          passwordHash,
          pinHash,
          // The global role: works at every outlet, needs no `outlet_staff` row.
          roleId: ownerRole.id,
        })
        .returning({ id: users.id })
        .then(([row]) => row!)
        .catch((error: unknown) => {
          if (isUniqueViolation(error))
            throw new TRPCError({ code: 'CONFLICT', message: 'Username sudah dipakai.' });
          throw error;
        });

      const [outlet] = await tx
        .insert(outlets)
        .values({
          name: input.outlet.name,
          code: normalizeCode(input.outlet.code),
          address: input.outlet.address || null,
          timezone: input.outlet.timezone,
          businessDayCutoff: input.outlet.businessDayCutoff,
        })
        .returning();

      // The new owner is the actor: there is nobody else yet.
      await audit(
        tx,
        { user: { id: owner.id }, outletId: outlet!.id, global: true },
        {
          outletId: outlet!.id,
          module: 'outlet',
          action: 'outlet.create',
          entityType: 'outlet',
          entityId: outlet!.id,
          after: outlet,
        },
      );
    });
  }
}
