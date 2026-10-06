import { describe, expect, it } from 'vitest';
import { DOMAINS, MOUNTS, parseDeployment } from './deployment-rules';

describe('MOUNTS', () => {
  it('cloud serves the backoffice: no floor, no outlet sync outbox', () => {
    expect([...MOUNTS.cloud].sort()).toEqual(
      ['addon', 'audit', 'auth', 'category', 'menu', 'outlet', 'role', 'settings'].sort(),
    );
  });

  it('local serves the hub: floor, sync and first-run setup, no backoffice audit viewer', () => {
    expect([...MOUNTS.local].sort()).toEqual(
      ['addon', 'auth', 'category', 'floor', 'menu', 'outlet', 'role', 'settings', 'setup', 'sync'].sort(),
    );
  });

  it('all mounts every domain, and every domain is mounted somewhere real', () => {
    expect(MOUNTS.all).toEqual(DOMAINS);
    const served = new Set([...MOUNTS.cloud, ...MOUNTS.local]);
    expect(DOMAINS.filter((d) => !served.has(d))).toEqual([]);
  });
});

describe('parseDeployment', () => {
  it('accepts the three modes', () => {
    expect(parseDeployment('cloud')).toBe('cloud');
    expect(parseDeployment('local')).toBe('local');
    expect(parseDeployment('all')).toBe('all');
  });

  it('refuses a missing or unknown mode instead of defaulting', () => {
    expect(() => parseDeployment(undefined)).toThrow(/DEPLOYMENT/);
    expect(() => parseDeployment('Cloud')).toThrow(/DEPLOYMENT/);
  });
});
