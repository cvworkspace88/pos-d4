/**
 * The cost price is margin data: a caller who may only read the menu gets every item with its cost
 * blanked. Only `menu.manage` sees it.
 */
export const forViewer = <T extends { cost: number | null }>(items: T[], held: readonly string[]): T[] =>
  held.includes('menu.manage') ? items : items.map((item) => ({ ...item, cost: null }));
