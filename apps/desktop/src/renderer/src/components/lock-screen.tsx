import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { LOCKED_DIALOG, isInvalidPin, isLocked } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Keypad } from '@repo/ui/keypad';
import { PinInput } from '@repo/ui/pin-input';
import { PasswordField } from '@repo/ui/text-field';
import { useAuthStore } from '../stores/auth';
import { refreshClient, useTRPC } from '../trpc';

const PIN_LENGTH = 6;

/** A tRPC refusal carries `data`; a request that never reached the API says what to do next instead. */
const errorText = (error: { message: string }) =>
  (error as { data?: unknown }).data
    ? error.message
    : 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.';

/**
 * The lock screen (US-007), rendered instead of the app, so nothing of the desk stays mounted behind it.
 *
 * - Parked (no access token): the user has a PIN, so locking parked the session like a tablet's sign
 *   out. Their PIN, on the keypad or the keyboard, redeems it through `auth.pinLogin` (the PIN's own
 *   5-in-10 lock).
 * - Not parked: a user with no PIN. The session stays alive and their password lifts the lock
 *   (`auth.unlock`, the password lock).
 *
 * Either way only the same user gets back in; anyone else uses "Ganti pengguna".
 */
export function LockScreen({ onSignOut }: { onSignOut: () => void }) {
  const trpc = useTRPC();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setSession = useAuthStore((s) => s.setSession);
  const setLocked = useAuthStore((s) => s.setLocked);
  const parked = !accessToken;
  const [secret, setSecret] = useState('');

  const unlock = useMutation(trpc.auth.unlock.mutationOptions({ onSuccess: () => setLocked(false) }));
  // Link-less client, like the refresh call: there is no access token to send. A dead profile is a
  // plain UNAUTHORIZED, which the mutation cache turns into a sign-out; a wrong PIN is not.
  const pinUnlock = useMutation({
    mutationFn: (pin: string) => refreshClient.auth.pinLogin.mutate({ refreshToken: refreshToken!, pin }),
    onSuccess: (session) => {
      // Unlock first: `setSession` ignores a session that lands while the desk is parked.
      setLocked(false);
      setSession(session);
    },
  });
  const attempt = parked ? pinUnlock : unlock;
  // A lock gets the dialog instead of the alert; dismissing it clears the error.
  const locked = isLocked(attempt.error);
  const dismissLocked = () => {
    attempt.reset();
    setSecret('');
  };

  // As on the tablet: a rejected PIN stays on screen in red until the next key replaces it.
  const press = (digit: string) => {
    if (pinUnlock.isPending || locked) return;
    const next = ((pinUnlock.error ? '' : secret) + digit).slice(0, PIN_LENGTH);
    pinUnlock.reset();
    setSecret(next);
    // Six digits is a whole PIN: open straight away, no extra tap. Rejections render below.
    if (next.length === PIN_LENGTH) pinUnlock.mutateAsync(next).catch(() => undefined);
  };
  const backspace = () => {
    if (pinUnlock.isPending || locked) return;
    setSecret((current) => (pinUnlock.error ? '' : current.slice(0, -1)));
    pinUnlock.reset();
  };

  return (
    <div
      data-testid="lock-screen"
      className="flex h-screen items-center justify-center bg-surface-canvas p-6"
    >
      <Card className="w-full max-w-md gap-6 p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-16 items-center justify-center rounded-full bg-lavender-light text-xl font-semibold text-ink-secondary">
            {(user?.name ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-ink-primary">{user?.name ?? '—'}</h1>
          <p className="text-sm text-ink-tertiary">
            Layar terkunci. Masukkan {parked ? 'PIN' : 'password'} untuk membuka.
          </p>
        </div>

        {parked ? (
          <div data-testid="lock-pin" className="flex flex-col gap-6">
            <PinInput length={PIN_LENGTH} value={secret} invalid={isInvalidPin(pinUnlock.error)} />
            {/* The counter PC has a keyboard too: its digits and Backspace drive the same pad. */}
            <Keypad keyboard onPress={press} onBackspace={backspace} disabled={pinUnlock.isPending} />
          </div>
        ) : (
          <form
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              setSecret('');
              // Rejections render in the alert below; an unhandled one would crash the renderer.
              unlock.mutateAsync({ password: secret }).catch(() => undefined);
            }}
          >
            <PasswordField
              data-testid="lock-password"
              label="Kata sandi"
              autoComplete="current-password"
              autoFocus
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <Button type="submit" size="lg" className="w-full" disabled={!secret || unlock.isPending}>
              {unlock.isPending ? 'Memproses…' : 'Buka kunci'}
            </Button>
          </form>
        )}

        {attempt.error && !locked && (
          <Alert data-testid="lock-error" variant="danger" role="alert">
            {errorText(attempt.error)}
          </Alert>
        )}

        <Button variant="ghost" className="w-full" onClick={onSignOut}>
          Ganti pengguna
        </Button>
      </Card>

      <Dialog
        open={locked}
        onClose={dismissLocked}
        blocking
        title={LOCKED_DIALOG.title}
        footer={
          <Button type="button" onClick={dismissLocked}>
            {LOCKED_DIALOG.button}
          </Button>
        }
      >
        <p className="text-sm text-ink-secondary">{LOCKED_DIALOG.message}</p>
      </Dialog>
    </div>
  );
}
