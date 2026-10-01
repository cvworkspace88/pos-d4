// Duplicated from packages/api-contract/src/addon.ts's `getSelectAddonErrorMessage`, not imported: apps/api
// cannot import that package at runtime.

export const getSelectAddonErrorMessage = ({
  min,
  max,
  optionCount,
}: {
  min: number;
  max: number;
  optionCount: number;
}): string | null => {
  if (optionCount === 0) return 'Tambahkan minimal satu pilihan.';
  if (max < 1) return 'Pilihan maksimum minimal 1.';
  if (min > max) return 'Pilihan minimum tidak boleh melebihi maksimum.';
  if (min > optionCount) return `Pilihan minimum melebihi jumlah pilihan (${optionCount}).`;
  return null;
};

/** Which message a unique violation earns. Null: rethrow, don't guess. */
export const addonConflictMessage = (constraint: string): string | null => {
  if (constraint === 'addon_groups_outlet_name_active_idx') return 'Nama add-on sudah dipakai.';
  return null;
};
