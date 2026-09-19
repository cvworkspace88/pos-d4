import { useMutation } from '@tanstack/react-query';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { useAuthStore } from '../stores/auth';
import { refreshClient } from '../trpc';

/**
 * Picking an outlet is `auth.refresh` with an `outletId`: the server reissues the session for that
 * outlet. It goes through the link-less refresh client for the same reason the token provider
 * does — the authenticated client would try to refresh on top of it.
 */
export function OutletPicker({ onSignOut }: { onSignOut: () => void }) {
  const { refreshToken, outlets, outlet, setSession } = useAuthStore();

  const pick = useMutation({
    mutationFn: (outletId: string) =>
      refreshClient.auth.refresh.mutate({ refreshToken: refreshToken!, outletId }),
    onSuccess: setSession,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
      <Card className="w-full max-w-md gap-6 p-8">
        <h1 className="text-2xl font-bold text-ink-primary">Pilih outlet</h1>

        {outlets.length === 0 && (
          <Alert variant="warning" role="alert">
            Belum ada outlet untuk akun ini. Minta pemilik menambahkanmu.
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          {outlets.map((o) => (
            <Button
              key={o.id}
              size="lg"
              variant={o.id === outlet?.id ? 'default' : 'outline'}
              className="w-full"
              disabled={pick.isPending}
              onClick={() => pick.mutate(o.id)}
            >
              {o.name}
            </Button>
          ))}
        </div>

        {pick.error && (
          <Alert variant="danger" role="alert">
            {pick.error.message}
          </Alert>
        )}

        <Button variant="ghost" onClick={onSignOut}>
          Keluar
        </Button>
      </Card>
    </div>
  );
}
