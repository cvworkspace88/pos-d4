type Costed = { cost: number | null };

/**
 * The cost price is margin data: a caller who may only read the menu gets every item — and every
 * variant — with its cost blanked. Only `menu.manage` sees it.
 */
export const forViewer = <T extends Costed & { variants: Costed[] }>(
  items: T[],
  held: readonly string[],
): T[] =>
  held.includes('menu.manage')
    ? items
    : items.map((item) => ({
        ...item,
        cost: null,
        variants: item.variants.map((v) => ({ ...v, cost: null })),
      }));

/** Kode menu as stored: trimmed, uppercase; blank means none. */
export const normalizeCode = (raw: string | null): string | null => raw?.trim().toUpperCase() || null;

/** The "mulai dari" price of an item with variants. Callers pass a non-empty list. */
export const startingPrice = (variants: { price: number }[]): number =>
  Math.min(...variants.map((v) => v.price));

/** The first name repeated within one input (trimmed, case-insensitive), or null. Variants and options. */
export const duplicateName = (rows: { name: string }[]): string | null => {
  const seen = new Set<string>();
  for (const { name } of rows) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return name.trim();
    seen.add(key);
  }
  return null;
};

/** One id sent twice in a set-save: both updates would hit the same row and one entry would vanish. */
export const hasDuplicateId = (rows: { id?: string }[]): boolean => {
  const ids = rows.flatMap((r) => (r.id ? [r.id] : []));
  return new Set(ids).size !== ids.length;
};

const CONFLICTS: Record<string, string> = {
  menu_items_outlet_name_active_idx: 'Nama menu sudah dipakai.',
  menu_items_outlet_code_active_idx: 'Kode menu sudah dipakai.',
};

/** Which message a unique violation earns, read off the index Postgres names. Null: rethrow, don't guess. */
export const menuConflictMessage = (constraint: string): string | null => CONFLICTS[constraint] ?? null;
