import { Menu } from '@base-ui/react/menu';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, KeyRound, Lock, LogOut, SquareAsterisk } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { roleLabel } from '../roles';
import { useAuthStore } from '../stores/auth';
import { refreshClient, trpcClient, useTRPC } from '../trpc';
import { ChangePasswordDialog } from './change-password-dialog';
import { ChangePinDialog } from './change-pin-dialog';
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
  const me = useQuery(trpc.auth.me.queryOptions());
  const settings = useQuery(trpc.settings.get.queryOptions());
  const lockSeconds = settings.data?.desktopLockSeconds ?? 0;
  const [account, setAccount] = useState<'password' | 'pin' | null>(null);
  // Lock parks the session when the user has a PIN to reopen it with (app.tsx makes everyone set one
  // before the shell opens); without one it only covers the desk and the password lifts it. One
  // source for `hasPin`: the store's user, which a PIN change updates. The app unmounts behind the
  // lock screen either way.
  const canPark = user?.hasPin ?? false;
  const lockDesk = useCallback(() => {
    const { refreshToken, park, setLocked } = useAuthStore.getState();
    if (!canPark || !refreshToken) return setLocked(true);
    park();
    // Fire-and-forget, like mobile's sign-out: the desk is locked locally either way, and a token the
    // call failed to park still opens only with the PIN on this screen.
    void refreshClient.auth.park.mutate({ refreshToken }).catch(() => undefined);
  }, [canPark]);

  // Auto-lock after `desktopLockSeconds` without input (US-007); 0 turns it off.
  useEffect(() => {
    if (!lockSeconds) return;
    // Input only stamps the time; one timer per lock period checks it, so mouse moves arm nothing.
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    ACTIVITY.forEach((type) => window.addEventListener(type, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last >= lockSeconds * 1000) lockDesk();
    }, 1000);
    return () => {
      clearInterval(timer);
      ACTIVITY.forEach((type) => window.removeEventListener(type, touch));
    };
  }, [lockSeconds, lockDesk]);

  return (
    <div className="flex h-screen bg-surface">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="flex flex-col gap-2 p-2">
          <OutletSwitcher />
        </div>

        {nav}

        <div className="flex items-center gap-1 border-t border-border-subtle p-2">
          {/* The profile opens the account menu: the user's own password and PIN. */}
          <Menu.Root>
            <Menu.Trigger className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-primary-lighter data-[popup-open]:bg-primary-lighter">
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
              <ChevronsUpDown className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="top" align="start" sideOffset={4} className="z-50">
                <Menu.Popup className="min-w-[var(--anchor-width)] rounded-lg border border-border bg-surface py-1 shadow-md outline-none">
                  <Menu.Item
                    onClick={() => setAccount('password')}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink-primary outline-none data-[highlighted]:bg-primary-lighter"
                  >
                    <KeyRound className="size-4 text-ink-tertiary" aria-hidden />
                    Ubah password
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => setAccount('pin')}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink-primary outline-none data-[highlighted]:bg-primary-lighter"
                  >
                    <SquareAsterisk className="size-4 text-ink-tertiary" aria-hidden />
                    Ubah PIN
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <button
            type="button"
            onClick={lockDesk}
            aria-label="Kunci"
            title="Kunci"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-primary-lighter"
          >
            <Lock className="size-5" />
          </button>
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
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-canvas">{children}</main>

      <ChangePasswordDialog open={account === 'password'} onClose={() => setAccount(null)} />
      <ChangePinDialog open={account === 'pin'} onClose={() => setAccount(null)} />
    </div>
  );
}
