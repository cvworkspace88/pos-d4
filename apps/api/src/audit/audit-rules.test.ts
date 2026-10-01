import { describe, expect, it } from 'vitest';
import { MASK, auditDiff } from './audit-rules';

describe('auditDiff', () => {
  it('keeps only the fields that changed', () => {
    expect(
      auditDiff({ id: 'a', name: 'Kopi', price: 20000 }, { id: 'a', name: 'Kopi', price: 22000 }),
    ).toEqual({
      before: { price: 20000 },
      after: { price: 22000 },
    });
  });

  it('is null when nothing changed, so a repeat save writes no row', () => {
    expect(auditDiff({ name: 'Kopi', tags: ['a'] }, { name: 'Kopi', tags: ['a'] })).toBeNull();
  });

  it('ignores updatedAt, which moves on every write', () => {
    const row = { name: 'Kopi', updatedAt: new Date('2026-10-01T00:00:00Z') };
    expect(auditDiff(row, { ...row, updatedAt: new Date('2026-10-01T01:00:00Z') })).toBeNull();
  });

  it('stores a create as after only and a delete as before only', () => {
    expect(auditDiff(null, { id: 'a', name: 'Kopi', createdAt: new Date() })).toEqual({
      before: null,
      after: { id: 'a', name: 'Kopi' },
    });
    expect(auditDiff({ id: 'a', name: 'Kopi' }, undefined)).toEqual({
      before: { id: 'a', name: 'Kopi' },
      after: null,
    });
    expect(auditDiff(null, null)).toBeNull();
  });

  it('masks secrets but still shows that they changed', () => {
    expect(auditDiff({ pinHash: 'h1', name: 'A' }, { pinHash: 'h2', name: 'A' })).toEqual({
      before: { pinHash: MASK },
      after: { pinHash: MASK },
    });
    expect(auditDiff(null, { username: 'budi', password: 'rahasia123', pin: null })).toEqual({
      before: null,
      after: { username: 'budi', password: MASK, pin: null },
    });
  });

  it('compares and stores dates as ISO strings, the way jsonb holds them', () => {
    expect(auditDiff({ deletedAt: null }, { deletedAt: new Date('2026-10-01T05:00:00Z') })).toEqual({
      before: { deletedAt: null },
      after: { deletedAt: '2026-10-01T05:00:00.000Z' },
    });
  });
});
