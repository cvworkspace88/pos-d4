import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { HUB_PING_MS, hubLink, hubUrl, type HubLink } from '@repo/api-contract';
import { currentHub, useHubStore } from '@/lib/stores/hub';
import { pingClient } from '@/lib/trpc';

const PING_TIMEOUT_MS = 5_000;

/**
 * Pings `hub.info` every 10 s while the app is in the foreground (US-003) and turns consecutive misses into
 * the banner state. Counted per hub: pairing another one starts from zero.
 */
export function useHubLink(): HubLink {
  const hub = useHubStore(currentHub);
  const key = hub ? hubUrl(hub) : null;
  const [misses, setMisses] = useState<{ key: string | null; count: number }>({ key, count: 0 });

  useEffect(() => {
    if (!key) return;
    let foreground = AppState.currentState === 'active';
    const ping = () => {
      if (!foreground) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      pingClient.hub.info
        .query(undefined, { signal: controller.signal })
        .then(
          () => setMisses({ key, count: 0 }),
          () => setMisses((m) => ({ key, count: m.key === key ? m.count + 1 : 1 })),
        )
        .finally(() => clearTimeout(timer));
    };
    ping();
    const interval = setInterval(ping, HUB_PING_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      // Back in front: ask now rather than show a stale state for up to ten seconds.
      if (foreground) ping();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [key]);

  return key ? hubLink(misses.key === key ? misses.count : 0) : 'online';
}
