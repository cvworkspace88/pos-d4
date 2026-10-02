import { useQuery } from '@tanstack/react-query';
import { Lock, LogOut } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@repo/ui/button';
import { roleLabel } from '../roles';
import { useAuthStore } from '../stores/auth';
import { trpcClient, useTRPC } from '../trpc';
import { ChangePassword } from './change-password-dialog';
import { LockScreen } from './lock-screen';
import { OutletSwitcher } from './outlet-switcher';

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

/**
 * Local state goes first, so a slow or failed call can never trap the user in a signed-in shell.
 * The server call is fire-and-forget: without it the refresh token stays valid for its full 30 days.
 */
export function signOut() {
  const { refreshToken, clear } = useAuthStore.getState();
  clear();
  if (refreshToken) void trpcClient.auth.logout.mutate({ refreshToken }).catch(() => undefined);
}

/**
 * The backoffice shell, cloned: a flush 16rem rail with a sticky header (outlet switcher) and
 * sticky footer (profile), the `nav` slot between them, and the page in its own scroll container.
 *
 * ponytail: static rail — no collapse/offcanvas. Add if the counter ever runs on a narrow screen.
 */
export function Shell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const trpc = useTRPC();
  const user = useAuthStore((s) => s.user);
  const locked = useAuthStore((s) => s.locked);
  const setLocked = useAuthStore((s) => s.setLocked);
  const me = useQuery(trpc.auth.me.queryOptions());
  const settings = useQuery(trpc.settings.get.queryOptions());
  const lockSeconds = settings.data?.desktopLockSeconds ?? 0;

  // Auto-lock after `desktopLockSeconds` without input (US-007); 0 turns it off.
  useEffect(() => {
    if (locked || !lockSeconds) return;
    // Input only stamps the time; one timer per lock period checks it, so mouse moves arm nothing.
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    ACTIVITY.forEach((type) => window.addEventListener(type, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last >= lockSeconds * 1000) setLocked(true);
    }, 1000);
    return () => {
      clearInterval(timer);
      ACTIVITY.forEach((type) => window.removeEventListener(type, touch));
    };
  }, [locked, lockSeconds, setLocked]);

  return (
    <div className="flex h-screen bg-surface">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="flex flex-col gap-2 p-2">
          <OutletSwitcher />
        </div>

        {nav}

        <div className="flex flex-col gap-2 border-t border-border-subtle p-2">
          <div className="flex h-12 w-full items-center gap-2 rounded-md p-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lavender-light text-[11px] font-semibold text-ink-secondary">
              {(user?.name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-ink-primary">
                {user?.name ?? '—'}
              </span>
              <span className="block truncate text-xs text-ink-tertiary">
                {me.data?.role ? `${roleLabel(me.data.role)} · ` : ''}
                {user?.username ?? '—'}
              </span>
            </div>
            {/* Signs out to the login screen, which is how another person takes over this desk. */}
            <button
              type="button"
              onClick={signOut}
              aria-label="Ganti pengguna"
              title="Ganti pengguna"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-light"
            >
              <LogOut className="size-5" />
            </button>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="flex-1 px-2" onClick={() => setLocked(true)}>
              <Lock className="mr-1 size-4" aria-hidden />
              Kunci
            </Button>
            <ChangePassword />
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-canvas">{children}</main>

      {locked && <LockScreen onSignOut={signOut} />}
    </div>
  );
}
