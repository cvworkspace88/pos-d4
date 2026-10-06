import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { LOCKED_DIALOG, isLocked, needsPassword } from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { PasswordField } from '@repo/ui/text-field';
import { useToast } from '@repo/ui/toast';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

// Mirrors auth.router.ts's setPin input; the repeat never leaves the client.
const base = z.object({
  pin: z.string().regex(/^\d{6}$/, 'Harus 6 digit.'),
  confirm: z.string(),
  password: z.string(),
});
const samePin = (schema: typeof base) =>
  schema.refine((v) => v.confirm === v.pin, { path: ['confirm'], message: 'PIN tidak sama.' });
const pinOnly = zodResolver(samePin(base));
const withPassword = zodResolver(
  samePin(base.extend({ password: z.string().min(8, 'Minimal 8 karakter.').max(128) })),
);

type FormValues = z.infer<typeof base>;

/** Drops anything but digits as it is typed, instead of only on submit. */
export const digitsOnly = (field: UseFormRegisterReturn) => ({
  ...field,
  onChange: (e: ChangeEvent<HTMLInputElement>) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    return field.onChange(e);
  },
});

const EMPTY: FormValues = { password: '', pin: '', confirm: '' };

/**
 * The user's PIN (US-006): what reopens a parked desk and a tablet profile, and approves overrides.
 *
 * - `firstRun`: "Buat PIN", forced right after a password login when the user has none (app.tsx).
 *   No password — unless the server says the login is no longer fresh (`NEEDS_PASSWORD`), or a PIN
 *   was made elsewhere meanwhile; then the password field appears and the same submit sends it.
 *   Its way out is "Keluar" (sign out), never a skip.
 * - Otherwise: "Ubah PIN" from the account menu, password always.
 */
export function ChangePinDialog({
  open,
  onClose,
  firstRun = false,
}: {
  open: boolean;
  onClose: () => void;
  firstRun?: boolean;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const setUser = useAuthStore((s) => s.setUser);
  const [askPassword, setAskPassword] = useState(!firstRun);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = // react-hook-form re-reads its options each render: the resolver follows `askPassword` and the
    // typed digits survive the switch.
    useForm<FormValues>({ resolver: askPassword ? withPassword : pinOnly, defaultValues: EMPTY });

  const setPin = useMutation(
    trpc.auth.setPin.mutationOptions({
      onSuccess: (updated) => {
        // The store's user is what the first-run screen, the shell and the lock read `hasPin` from.
        setUser(updated);
        // First run has no dialog to close: `hasPin` lets app.tsx open the shell, and `onClose` there
        // is "Keluar", which must not run on success.
        if (firstRun) setPin.reset();
        else close();
        toast.add({ type: 'success', title: firstRun ? 'PIN dibuat.' : 'PIN diubah.' });
      },
      onError: (error) => {
        if (needsPassword(error)) setAskPassword(true);
      },
    }),
  );

  // Declared after the mutation on purpose: each only touches the other from an event.
  const close = () => {
    reset(EMPTY);
    setPin.reset();
    onClose();
  };

  // A lock gets the shared dialog instead of the inline error; dismissing it clears the error.
  const locked = isLocked(setPin.error);

  return (
    <>
      <Dialog
        open={open && !locked}
        onClose={close}
        blocking
        closeButton={false}
        title={firstRun ? 'Buat PIN' : 'Ubah PIN'}
        footer={
          <div className="flex w-full flex-col gap-3">
            {setPin.error && (
              <div role="alert" className="flex flex-row items-center gap-1 text-sm text-danger">
                <TriangleAlertIcon className="size-4" /> {setPin.error.message}
              </div>
            )}
            <div className="flex gap-3">
              <Button type="submit" form="change-pin-form" className="flex-1" loading={setPin.isPending}>
                Simpan
              </Button>
              <Button variant="outline" className="flex-1" onClick={close} disabled={setPin.isPending}>
                {firstRun ? 'Keluar' : 'Batal'}
              </Button>
            </div>
          </div>
        }
      >
        <form
          id="change-pin-form"
          className="flex flex-col gap-4"
          // Rejections render in the footer; an unhandled one would crash the renderer.
          onSubmit={handleSubmit(({ password, pin }) =>
            setPin.mutateAsync({ pin, password: askPassword ? password : undefined }).catch(() => undefined),
          )}
        >
          <p className="text-sm text-ink-secondary">
            {firstRun
              ? 'Buat PIN untuk membuka kunci layar dan masuk di tablet.'
              : 'PIN dipakai untuk membuka kunci layar dan masuk di tablet.'}
          </p>
          {askPassword && (
            <PasswordField
              label="Password"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />
          )}
          <PasswordField
            label="PIN baru"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            error={errors.pin?.message}
            {...digitsOnly(register('pin'))}
          />
          <PasswordField
            label="Ulangi PIN baru"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            error={errors.confirm?.message}
            {...digitsOnly(register('confirm'))}
          />
        </form>
      </Dialog>

      <Dialog
        open={locked}
        onClose={close}
        blocking
        title={LOCKED_DIALOG.title}
        footer={
          <Button type="button" onClick={close}>
            {LOCKED_DIALOG.button}
          </Button>
        }
      >
        <p className="text-sm text-ink-secondary">{LOCKED_DIALOG.message}</p>
      </Dialog>
    </>
  );
}
