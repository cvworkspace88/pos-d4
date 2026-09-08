import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { reservations, tables, type Reservation } from '../db/schema';

export type ReservationStatus = Reservation['status'];

export interface ReservationInput {
  tableId: string;
  customerName: string;
  phone?: string;
  partySize: number;
  /** ISO datetime with offset; stored as timestamptz. */
  startsAt: string;
  note?: string;
}

export type ReservationPatch = Partial<ReservationInput> & { status?: Exclude<ReservationStatus, 'booked'> };

export const reservationOutput = (r: Reservation) => ({
  id: r.id,
  tableId: r.tableId,
  customerName: r.customerName,
  phone: r.phone,
  partySize: r.partySize,
  startsAt: r.startsAt.toISOString(),
  note: r.note,
  status: r.status,
});
export type ReservationOutput = ReturnType<typeof reservationOutput>;

@Injectable()
export class ReservationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(from: string, to: string): Promise<ReservationOutput[]> {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(and(gte(reservations.startsAt, new Date(from)), lt(reservations.startsAt, new Date(to))))
      .orderBy(asc(reservations.startsAt));
    return rows.map(reservationOutput);
  }

  async create(userId: string, input: ReservationInput): Promise<ReservationOutput> {
    await this.requireLiveTable(input.tableId);
    const [row] = await this.db
      .insert(reservations)
      .values({ ...input, startsAt: new Date(input.startsAt), createdBy: userId })
      .returning();
    return reservationOutput(row!);
  }

  /** Only a booked reservation changes. Seated, cancelled and no-show are terminal. */
  async update(id: string, patch: ReservationPatch): Promise<ReservationOutput> {
    const [current] = await this.db.select().from(reservations).where(eq(reservations.id, id));
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reservation not found.' });
    if (current.status !== 'booked')
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Reservation is closed.' });
    if (patch.tableId) await this.requireLiveTable(patch.tableId);

    // drizzle rejects an UPDATE with nothing to set; an empty patch is a no-op read.
    const { startsAt, ...rest } = patch;
    const set = { ...rest, ...(startsAt ? { startsAt: new Date(startsAt) } : {}) };
    if (Object.values(set).every((v) => v === undefined)) return reservationOutput(current);

    const [row] = await this.db.update(reservations).set(set).where(eq(reservations.id, id)).returning();
    return reservationOutput(row!);
  }

  private async requireLiveTable(tableId: string): Promise<void> {
    const [table] = await this.db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.id, tableId), isNull(tables.deletedAt)));
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });
  }
}
