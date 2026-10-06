import { createTRPCClient, httpLink } from '@trpc/client';
import { HUB_UNREACHABLE, checkHub, hubUrl, type AppRouter } from '@repo/api-contract';
import { useAuthStore } from './stores/auth';
import { useHubStore, type SavedHub } from './stores/hub';
import { queryClient } from './trpc';

const PROBE_TIMEOUT_MS = 5_000;

/** Asks `target` who it is, without touching the chosen hub. */
async function probeHub(target: { host: string; port: number }) {
  const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${hubUrl(target)}/trpc` })] });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await client.hub.info.query(undefined, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Makes `target` this tablet's hub once it answers as a set-up hub (and, from a QR, as `expectedOutletId`'s).
 * Throws an `Error` whose message is the text to show.
 */
export async function connectToHub(
  target: { host: string; port: number },
  expectedOutletId?: string,
): Promise<SavedHub> {
  const info = await probeHub(target).catch(() => {
    throw new Error(HUB_UNREACHABLE);
  });
  const problem = checkHub(info, expectedOutletId);
  if (problem) throw new Error(problem);

  // Field by field: callers pass richer objects (a discovered hub carries its mDNS name too).
  const hub: SavedHub = {
    host: target.host,
    port: target.port,
    outletId: info.outlet!.id,
    outletName: info.outlet!.name,
  };
  const { current } = useHubStore.getState();
  // Another outlet's hub is another database: this tablet's sessions and PIN profiles mean nothing there.
  if (current !== null && current !== hub.outletId) useAuthStore.getState().forgetAll();
  useHubStore.getState().choose(hub);
  queryClient.clear();
  return hub;
}
