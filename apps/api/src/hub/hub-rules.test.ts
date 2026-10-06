import type { NetworkInterfaceInfo } from 'node:os';
import { expect, test } from 'vitest';
import { advertName, lanAddresses } from './hub-rules.ts';

const nic = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
  ({ address, family, internal, netmask: '', mac: '', cidr: null }) as NetworkInterfaceInfo;

test('lanAddresses keeps the IPv4 a tablet can reach, in interface order', () => {
  expect(
    lanAddresses({
      lo0: [nic('127.0.0.1', 'IPv4', true), nic('::1', 'IPv6', true)],
      en0: [nic('fe80::1', 'IPv6'), nic('192.168.1.20', 'IPv4')],
      en5: [nic('169.254.10.2', 'IPv4')],
      en7: [nic('10.0.0.5', 'IPv4')],
      gone: undefined,
    }),
  ).toEqual(['192.168.1.20', '10.0.0.5']);
});

test('advertName fits one 63-byte DNS label without splitting a character', () => {
  expect(advertName('Kopi Senja', 'KASIR-PC')).toBe('Kopi Senja (KASIR-PC)');
  const long = advertName('Warung Makan Sederhana Cabang Kebayoran Baru Jakarta Selatan', 'KASIR-PC-01');
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(63);
  const emoji = advertName('☕'.repeat(30), 'pc');
  expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(63);
  expect(emoji).not.toMatch(/�/);
});
