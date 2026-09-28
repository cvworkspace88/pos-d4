/** The menu router's bound on a price or cost, in rupiah. */
export const MAX_RUPIAH = 100_000_000;

/**
 * Whole rupiah typed by a person: "35000" or "35.000", dots only as thousands separators. Anything
 * else — a decimal comma above all — is refused rather than stripped: "35.000,00" must not become
 * Rp 3.500.000. Empty is `null`; whether that is allowed is the caller's call.
 */
export const parseRupiah = (input: string): { value: number | null; error?: string } => {
  const t = input.trim();
  if (!t) return { value: null };
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(t))
    return { value: null, error: 'Angka bulat tanpa koma, contoh 35.000.' };
  const value = Number(t.replaceAll('.', ''));
  if (value > MAX_RUPIAH) return { value: null, error: 'Maksimal Rp 100.000.000.' };
  return { value };
};
