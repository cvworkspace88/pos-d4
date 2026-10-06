import { expect, test } from 'vitest';
import { isLoopback, isTrustedOrigin } from './setup-rules.ts';

test('loopback in every shape Node reports it', () => {
  expect(isLoopback('127.0.0.1')).toBe(true);
  expect(isLoopback('::1')).toBe(true);
  expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
});

test('a LAN peer or an unknown socket is not', () => {
  expect(isLoopback('192.168.1.20')).toBe(false);
  expect(isLoopback('::ffff:192.168.1.20')).toBe(false);
  expect(isLoopback('fe80::1')).toBe(false);
  expect(isLoopback(undefined)).toBe(false);
});

test('origins the desktop renderer can have are trusted', () => {
  for (const o of [
    undefined,
    'null',
    'file://',
    'http://localhost:5173',
    'http://127.0.0.1:3333',
    'http://[::1]:5173',
  ])
    expect(isTrustedOrigin(o)).toBe(true);
});

test('any other site in a browser on this machine is not', () => {
  for (const o of ['https://evil.example', 'http://localhost.evil.example', 'http://192.168.1.20:5173'])
    expect(isTrustedOrigin(o)).toBe(false);
});
