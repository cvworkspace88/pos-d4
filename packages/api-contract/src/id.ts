/**
 * UUID v7 (RFC 9562): a 48-bit millisecond timestamp, then random bits. Clients mint the id of every
 * transactional create (US-012), so a retried request carries the same id and the server returns the
 * stored row instead of writing a second one; ids also sort by creation time.
 *
 * React Native has no `crypto.getRandomValues`: mobile passes 10 bytes from expo-crypto.
 */
export const uuidv7 = (
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
  now: number = Date.now(),
): string => {
  const b = new Uint8Array(16);
  // `& 0xff` after ToInt32 still yields the right low byte: 2^32 is a multiple of 256.
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  b.set(random.subarray(0, 10), 6);
  b[6] = 0x70 | (b[6]! & 0x0f); // version 7
  b[8] = 0x80 | (b[8]! & 0x3f); // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
