/** An add-on group's pick rule in words, as the backoffice and (later) the cashier screen show it. */
export const describeRule = (min: number, max: number): string => {
  if (min === 0) return max === 1 ? 'Opsional, pilih 1' : `Opsional, maks ${max}`;
  return min === max ? `Wajib pilih ${min}` : `Wajib pilih ${min}–${max}`;
};

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
