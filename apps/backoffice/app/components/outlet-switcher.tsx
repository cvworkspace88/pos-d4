import { useMutation } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { Alert } from '@repo/ui/alert';
import { useToggle } from '@repo/hooks/use-toggle';
import { useAuthStore } from '../stores/auth';
import { refreshClient } from '../trpc';

/**
 * Switching outlet is `auth.refresh` with an `outletId`: the server reissues the session for that
 * outlet. It goes through the link-less refresh client for the same reason the token provider
 * does — the authenticated client would try to refresh on top of it.
 *
 * Only one outlet to choose from means nothing to switch to: the server already picked it
 * (`issueSession` selects a lone outlet), so the control renders inert.
 */
export function OutletSwitcher() {
  const { refreshToken, outlet, outlets, setSession } = useAuthStore();
  const [open, toggleOpen, setOpen] = useToggle();

  const pick = useMutation({
    mutationFn: (outletId: string) =>
      refreshClient.auth.refresh.mutate({ refreshToken: refreshToken!, outletId }),
    onSuccess: (session) => {
      setSession(session);
      setOpen(false);
    },
  });

  const switchable = outlets.length > 1;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!switchable || pick.isPending}
        onClick={toggleOpen}
        className="flex h-12 w-full items-center gap-2 rounded-md border border-border-subtle p-2 text-left transition-colors enabled:hover:bg-primary-lighter disabled:cursor-default"
      >
        <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
          P
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-ink-primary">POS 2.0</span>
          <span className="block truncate text-xs text-ink-tertiary">
            Lokasi aktif · {outlet?.name ?? '—'}
          </span>
        </div>
        {switchable && <ChevronsUpDown className="size-4 shrink-0 text-ink-tertiary" />}
      </button>

      {open && (
        <>
          {/* Cheapest light dismiss there is: a full-screen catcher under the panel. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-20 mt-1 flex flex-col gap-1">
            <ul className="overflow-hidden rounded-md border border-border-subtle bg-surface py-1 shadow-lg">
              {outlets.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={pick.isPending}
                    onClick={() => pick.mutate(o.id)}
                    className={`flex w-full items-center px-2 py-1.5 text-left text-sm transition-colors hover:bg-primary-lighter ${
                      o.id === outlet?.id ? 'font-medium text-ink-primary' : 'text-ink-secondary'
                    }`}
                  >
                    <span className="truncate">{o.name}</span>
                  </button>
                </li>
              ))}
            </ul>

            {pick.error && (
              <Alert variant="danger" role="alert">
                {pick.error.message}
              </Alert>
            )}
          </div>
        </>
      )}
    </div>
  );
}
