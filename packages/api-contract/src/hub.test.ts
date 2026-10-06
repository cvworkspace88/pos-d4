import assert from 'node:assert/strict';
import test from 'node:test';
import { HUB_PING_MS, checkHub, encodeHubQr, hubLink, hubUrl, parseHubQr } from './hub.ts';

const HUB = { host: '192.168.1.20', port: 3333, outletId: '0199a0c0-0000-7000-8000-000000000001' };

test('a hub QR round-trips, and only the three fields travel', () => {
  assert.deepEqual(parseHubQr(encodeHubQr(HUB)), HUB);
  assert.deepEqual(JSON.parse(encodeHubQr({ ...HUB, extra: 1 } as typeof HUB)), HUB);
});

test('anything that is not a hub QR parses to null instead of throwing', () => {
  for (const text of [
    'https://kafemelati.id/menu',
    '',
    'null',
    '[]',
    JSON.stringify({ ...HUB, host: '' }),
    JSON.stringify({ ...HUB, port: 0 }),
    JSON.stringify({ ...HUB, port: 70000 }),
    JSON.stringify({ ...HUB, port: '3333' }),
    JSON.stringify({ ...HUB, outletId: 7 }),
  ])
    assert.equal(parseHubQr(text), null, text);
});

test('hubUrl brackets IPv6 hosts', () => {
  assert.equal(hubUrl(HUB), 'http://192.168.1.20:3333');
  assert.equal(hubUrl({ host: 'fe80::1', port: 3333 }), 'http://[fe80::1]:3333');
});

test('banner: one miss is reconnecting, two are offline, any success is online', () => {
  assert.equal(hubLink(0), 'online');
  assert.equal(hubLink(1), 'reconnecting');
  assert.equal(hubLink(2), 'offline');
  assert.equal(hubLink(9), 'offline');
  assert.equal(HUB_PING_MS, 10_000);
});

test("checkHub refuses a hub that is not set up, or is another outlet's", () => {
  const info = { outlet: { id: HUB.outletId, name: 'Kopi Senja' } };
  assert.equal(checkHub(info), null);
  assert.equal(checkHub(info, HUB.outletId), null);
  assert.match(checkHub({ outlet: null }) ?? '', /belum disiapkan/);
  assert.match(checkHub(info, 'another-outlet') ?? '', /outlet lain/);
});
