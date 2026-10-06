import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { seedRbac } from '../role/seed-rbac';
import type { Actor } from '../auth/rbac-rules';
import { CategoryService } from '../category/category.service';
import { auditLog, roles, settings } from '../db/schema';
import { OutletService } from '../outlet/outlet.service';
import { SettingsService } from '../settings/settings.service';
import { connectTestDatabase, testActor, truncateAll, type TestDatabase } from '../test/test-db';
import { MASK } from './audit-rules';
import { AuditService } from './audit.service';

let db: TestDatabase;
let close: () => Promise<void>;
let service: AuditService;
let outlets: OutletService;
let ACTOR: Actor;
let outletId: string;

beforeAll(async () => {
  ({ db, close } = await connectTestDatabase());
  service = new AuditService(db);
  outlets = new OutletService(db);
  await seedRbac(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  ACTOR = await testActor(db);
  outletId = (await outlets.create({ name: 'Downtown', code: 'DT' }, ACTOR)).id;
});

const today = new Date().toISOString().slice(0, 10);
const query = (over: Partial<Parameters<AuditService['list']>[0]> = {}) => ({
  outletId,
  fromDate: '2000-01-01',
  toDate: '2999-12-31',
  ...over,
});
const actions = async (global = true, over = {}) =>
  (await service.list(query(over), global)).rows.map((r) => r.action);

const CHARGES = {
  pbjtLabel: 'PBJT',
  pbjtRateBp: 1000,
  pbjtInclusive: false,
  serviceName: 'Biaya Layanan',
  serviceRateBp: 500,
  servicePbjtTaxable: true,
  serviceOrderTypes: ['dine_in' as const],
  ppnInclusive: true,
  ppnRateBp: 1100,
};

test('a change writes one row in its transaction, holding only the fields that changed', async () => {
  await outlets.setCharges(outletId, CHARGES, ACTOR);
  const { rows } = await service.list(query({ module: 'outlet' }), true);
  expect(rows[0]).toMatchObject({
    action: 'outlet.set_charges',
    entityType: 'outlet',
    entityId: outletId,
    actorName: 'Actor',
    before: { serviceRateBp: 0 },
    after: { serviceRateBp: 500 },
  });
});

test('a repeat of the same save writes no second row', async () => {
  await outlets.setCharges(outletId, CHARGES, ACTOR);
  await outlets.setCharges(outletId, CHARGES, ACTOR);
  expect(await actions()).toEqual(['outlet.set_charges', 'outlet.create']);
});

test('a refused write leaves no audit row', async () => {
  await outlets.create({ name: 'Airport', code: 'AP' }, ACTOR);
  await expect(outlets.setCode(outletId, 'AP', ACTOR)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await actions()).toEqual(['outlet.create']);
});

test('the log is append-only: UPDATE and DELETE are refused by the database', async () => {
  // drizzle wraps the Postgres error; the trigger's message is on its cause.
  const refusal = { cause: { message: 'audit_log is append-only' } };
  await expect(db.update(auditLog).set({ reason: 'x' })).rejects.toMatchObject(refusal);
  await expect(db.delete(auditLog)).rejects.toMatchObject(refusal);
  await expect(db.execute(sql`delete from audit_log`)).rejects.toMatchObject(refusal);
});

test('a new staff PIN shows as set, never its value or hash', async () => {
  const [cashier] = await db.select().from(roles).where(eq(roles.name, 'cashier'));
  await outlets.addStaff(
    outletId,
    { name: 'Budi', username: 'Budi', password: 'rahasia123', pin: '123456', roleId: cashier!.id },
    ACTOR,
  );
  const { rows } = await service.list(query({ module: 'staff' }), true);
  expect(rows[0]!.after).toEqual({ name: 'Budi', username: 'budi', role: 'cashier', pin: MASK });
  expect(JSON.stringify(rows)).not.toContain('123456');
});

test('a category reorder is one row naming the old and new order', async () => {
  const categories = new CategoryService(db);
  const a = await categories.create(ACTOR, outletId, 'Kopi');
  const b = await categories.create(ACTOR, outletId, 'Teh');
  await categories.reorder(ACTOR, outletId, [b.id, a.id]);
  const { rows } = await service.list(query({ module: 'category' }), true);
  expect(rows[0]).toMatchObject({
    action: 'category.reorder',
    entityId: null,
    before: { order: ['Kopi', 'Teh'] },
    after: { order: ['Teh', 'Kopi'] },
  });
});

test('global rows (app settings) are listed for a global role only', async () => {
  await db.delete(settings); // not cleared by truncateAll; a leftover 300 would make this a no-op
  await new SettingsService(db).update({ idleTimeoutSeconds: 300 }, ACTOR);
  expect(await actions(true)).toContain('settings.update');
  expect(await actions(false)).not.toContain('settings.update');
});

test("another outlet's rows are not listed", async () => {
  const other = await outlets.create({ name: 'Airport', code: 'AP' }, ACTOR);
  await outlets.setCode(other.id, 'AP2', ACTOR);
  expect(await actions(false)).toEqual(['outlet.create']);
});

test('filters by module and by user', async () => {
  await outlets.setCharges(outletId, CHARGES, ACTOR);
  await new CategoryService(db).create(ACTOR, outletId, 'Kopi');
  expect(await actions(true, { module: 'category' })).toEqual(['category.create']);
  expect(await actions(true, { userId: ACTOR.user.id })).toHaveLength(3);
  const someoneElse = await testActor(db, false);
  expect(await actions(true, { userId: someoneElse.user.id })).toEqual([]);
});

test("dates are the outlet's calendar days, not UTC's", async () => {
  // 1 Sep 23:30 WIB is 16:30 UTC; 2 Sep 00:30 WIB is 17:30 UTC, still the 1st in UTC.
  const row = (createdAt: string, action: `outlet.${string}`) => ({
    outletId,
    actorUserId: ACTOR.user.id,
    module: 'outlet' as const,
    action,
    entityType: 'outlet',
    entityId: outletId,
    after: { x: 1 },
    createdAt: new Date(createdAt),
  });
  await db
    .insert(auditLog)
    .values([row('2026-09-01T16:30:00Z', 'outlet.late'), row('2026-09-01T17:30:00Z', 'outlet.next_day')]);
  expect(await actions(true, { fromDate: '2026-09-01', toDate: '2026-09-01' })).toEqual(['outlet.late']);
  expect(await actions(true, { fromDate: '2026-09-02', toDate: '2026-09-02' })).toEqual(['outlet.next_day']);
});

test('pages newest first through a cursor, with no gaps or repeats', async () => {
  // 120 rows in one statement share one created_at: the id tie-break is what keeps paging exact.
  await db.insert(auditLog).values(
    Array.from({ length: 120 }, (_, i) => ({
      outletId,
      actorUserId: ACTOR.user.id,
      module: 'outlet' as const,
      action: `outlet.n${i}`,
      entityType: 'outlet',
      entityId: outletId,
      after: { i },
    })),
  );
  const seen: string[] = [];
  let cursor: { createdAt: string; id: string } | undefined;
  let pages = 0;
  do {
    const page = await service.list(query({ cursor, fromDate: today, toDate: today }), true);
    seen.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor);
  expect(pages).toBe(3);
  expect(seen).toHaveLength(121); // 120 + outlet.create
  expect(new Set(seen).size).toBe(121);
});

test('actors lists everyone in the outlet log, for the user filter', async () => {
  expect(await service.actors(outletId, true)).toEqual([{ id: ACTOR.user.id, name: 'Actor' }]);
});
