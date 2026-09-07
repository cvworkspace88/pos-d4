import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

/** Until the server value arrives. Matches the server's own default. */
const FALLBACK_IDLE_SECONDS = 120;

/**
 * Parks the active session after `settings.idleTimeoutSeconds` without a touch. Returns `bump`,
 * to hang on the root view's `onStartShouldSetResponderCapture`. Runs nothing without a session.
 */
export function useIdleTimer(): () => void {
  const trpc = useTRPC();
  const active = useAuthStore((state) => state.accessToken !== null);
  const settings = useQuery({
    ...trpc.settings.get.queryOptions(),
    enabled: active,
    staleTime: 5 * 60_000,
  });
  const idleMs = (settings.data?.idleTimeoutSeconds ?? FALLBACK_IDLE_SECONDS) * 1000;

  // Initialised to 0, not Date.now(): calling an impure function during render trips
  // react-hooks/purity, and the effect and every touch assign a real timestamp before it is read.
  const lastActive = useRef(0);
  const arm = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Arms for the time still owed, never a fresh full window. A flat `setTimeout(park, idleMs)`
    // here would let every return from the background push the deadline out again, so a tablet
    // picked up and put down repeatedly would never lock.
    arm.current = () => {
      clearTimeout(timer);
      const remaining = idleMs - (Date.now() - lastActive.current);
      if (remaining <= 0) park();
      else timer = setTimeout(park, remaining);
    };
    lastActive.current = Date.now();
    arm.current();

    // JS timers freeze while the app is in the background, so the wall clock is the only truthful
    // source on return. `arm` reads it: overdue parks at once, otherwise it re-arms for the
    // remainder of the original window.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') arm.current();
    });

    return () => {
      subscription.remove();
      clearTimeout(timer);
      arm.current = () => {};
    };
  }, [active, idleMs]);

  return useCallback(() => {
    lastActive.current = Date.now();
    arm.current();
  }, []);
}
