import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/auth';
import { trpcClient } from '../trpc';
import { OutletSwitcher } from './outlet-switcher';

/**
 * Local state goes first, so a slow or failed call can never trap the user in a signed-in shell.
 * The server call is fire-and-forget: without it the refresh token stays valid for its full 30 days.
 */
function signOut() {
  const { refreshToken, clear } = useAuthStore.getState();
  clear();
  if (refreshToken) void trpcClient.auth.logout.mutate({ refreshToken }).catch(() => undefined);
}

/**
 * Layout shell only, shaped after shadcn's sidebar: a flush 16rem rail with a sticky header
 * (outlet switcher) and sticky footer (profile), a scrollable menu region between them, and the
 * page content in its own scroll container.
 *
 * ponytail: static rail — no collapse/offcanvas, no SidebarProvider, no cmd+B. Add if the
 * backoffice ever needs the icon-only state on small screens.
 */
export function Shell({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex h-screen bg-surface">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="flex flex-col gap-2 p-2">
          <OutletSwitcher />
        </div>

        {/* menu groups land here: <p class="h-8 px-2 text-xs font-medium text-ink-tertiary"> label
            + <ul class="flex flex-col gap-1"> of h-8 rounded-md buttons */}
        <nav className="min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" />

        <div className="flex flex-col gap-2 border-t border-border-subtle p-2">
          <div className="flex h-12 w-full items-center gap-2 rounded-md p-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lavender-light text-[11px] font-semibold text-ink-secondary">
              {(user?.name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-ink-primary">
                {user?.name ?? '—'}
              </span>
              <span className="block truncate text-xs text-ink-tertiary">{user?.username ?? '—'}</span>
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Keluar"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-light"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-canvas">{children}</main>
    </div>
  );
}
