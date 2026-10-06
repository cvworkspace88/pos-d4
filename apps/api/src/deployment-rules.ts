export const DEPLOYMENTS = ['cloud', 'local', 'all'] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

/** One entry per Nest domain module; `app.module.ts` maps each to its class. */
export const DOMAINS = [
  'auth',
  'settings',
  'outlet',
  'role',
  'category',
  'menu',
  'addon',
  'audit',
  'floor',
  'sync',
  'setup',
] as const;
export type Domain = (typeof DOMAINS)[number];

// The desktop is local-first: catalogue, staff and settings mutations exist on both sides.
const SHARED: Domain[] = ['auth', 'settings', 'outlet', 'role', 'category', 'menu', 'addon'];

/**
 * What each process mounts. `cloud` serves the backoffice, `local` the hub that mobile and
 * desktop talk to. `all` is everything, for contract generation only — it never listens.
 */
export const MOUNTS: Record<Deployment, readonly Domain[]> = {
  cloud: [...SHARED, 'audit'],
  // `setup` is public and creates the owner: the hub only, never the internet-facing cloud.
  local: [...SHARED, 'floor', 'sync', 'setup'],
  all: DOMAINS,
};

export function parseDeployment(value: string | undefined): Deployment {
  if (DEPLOYMENTS.includes(value as Deployment)) return value as Deployment;
  throw new Error(`DEPLOYMENT must be one of ${DEPLOYMENTS.join('|')}, got ${JSON.stringify(value)}.`);
}
