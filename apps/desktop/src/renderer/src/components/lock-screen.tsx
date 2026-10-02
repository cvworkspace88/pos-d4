import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { LOCKED_DIALOG, isLocked } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { PasswordField } from '@repo/ui/text-field';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

/**
 * The lock screen (US-007): the session stays alive behind it, only the user's own password lifts it.
 * A Base UI modal rather than a plain overlay, so it inerts the app — and any dialog already open in
 * it — and stays on top of them; opaque so nothing on the counter shows through. It has no z-index,
 * which keeps the locked dialog (opened later, so portalled later) above it.
 */
export function LockScreen({ onSignOut }: { onSignOut: () => void }) {
  const trpc = useTRPC();
  const user = useAuthStore((s) => s.user);
  const setLocked = useAuthStore((s) => s.setLocked);
  const [password, setPassword] = useState('');

  const unlock = useMutation(trpc.auth.unlock.mutationOptions({ onSuccess: () => setLocked(false) }));
  // A lock gets the dialog instead of the alert; dismissing it clears the error.
  const locked = isLocked(unlock.error);

  return (
    <BaseDialog.Root open modal disablePointerDismissal onOpenChange={() => undefined}>
      <BaseDialog.Portal>
        <BaseDialog.Popup
          data-testid="lock-screen"
          className="fixed inset-0 flex items-center justify-center bg-surface-canvas p-6"
        >
          <form
            className="w-full max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              setPassword('');
              // Rejections render in the alert below; an unhandled one would crash the renderer.
              unlock.mutateAsync({ password }).catch(() => undefined);
            }}
          >
            <Card className="gap-6 p-8">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-16 items-center justify-center rounded-full bg-lavender-light text-xl font-semibold text-ink-secondary">
                  {(user?.name ?? '?').slice(0, 2).toUpperCase()}
                </div>
                <BaseDialog.Title className="text-2xl font-bold text-ink-primary">
                  {user?.name ?? '—'}
                </BaseDialog.Title>
                <p className="text-sm text-ink-tertiary">Layar terkunci. Masukkan password untuk membuka.</p>
              </div>

              <PasswordField
                data-testid="lock-password"
                label="Kata sandi"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {unlock.error && !locked && (
                <Alert data-testid="lock-error" variant="danger" role="alert">
                  {unlock.error.message}
                </Alert>
              )}

              <div className="flex flex-col gap-3">
                <Button type="submit" size="lg" className="w-full" disabled={!password || unlock.isPending}>
                  {unlock.isPending ? 'Memproses…' : 'Buka kunci'}
                </Button>
                <Button variant="ghost" className="w-full" onClick={onSignOut}>
                  Ganti pengguna
                </Button>
              </div>
            </Card>
          </form>
        </BaseDialog.Popup>
      </BaseDialog.Portal>

      <Dialog
        open={locked}
        onClose={() => unlock.reset()}
        blocking
        title={LOCKED_DIALOG.title}
        footer={
          <Button type="button" onClick={() => unlock.reset()}>
            {LOCKED_DIALOG.button}
          </Button>
        }
      >
        <p className="text-sm text-ink-secondary">{LOCKED_DIALOG.message}</p>
      </Dialog>
    </BaseDialog.Root>
  );
}
