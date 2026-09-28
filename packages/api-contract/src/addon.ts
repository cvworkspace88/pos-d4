/** An add-on group's pick rule in words, as the backoffice and (later) the cashier screen show it. */
export const describeRule = (min: number, max: number): string => {
  if (min === 0) return max === 1 ? 'Opsional, pilih 1' : `Opsional, maks ${max}`;
  return min === max ? `Wajib pilih ${min}` : `Wajib pilih ${min}–${max}`;
};
