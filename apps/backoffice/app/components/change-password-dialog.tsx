import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, TriangleAlertIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LOCKED_DIALOG, isLocked } from '@repo/api-contract';
import { useDialog } from '@repo/hooks/use-dialog';
import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { PasswordField } from '@repo/ui/text-field';
import { useToast } from '@repo/ui/toast';
import { useTRPC } from '../trpc';

// Mirrors auth.changePassword's input — the server still validates, this only spares a round trip.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Wajib diisi.').max(128),
    newPassword: z.string().min(8, 'Minimal 8 karakter.').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Password tidak sama.' });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { currentPassword: '', newPassword: '', confirm: '' };

/** The profile's key button and its dialog (US-005). A wrong current password counts toward the login lock. */
export function ChangePassword() {
  const trpc = useTRPC();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        dialog.close();
        toast.add({ type: 'success', title: 'Password berhasil diubah.' });
      },
    }),
  );

  // Declared after the mutation on purpose: each only touches the other from an event.
  const dialog = useDialog(() => {
    reset(EMPTY);
    change.reset();
  });

  // A lock swaps the form for the shared locked dialog; dismissing it closes both.
  const locked = isLocked(change.error);

  return (
    <>
      <button
        type="button"
        onClick={dialog.open}
        aria-label="Ubah password"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-primary-lighter"
      >
        <KeyRound className="size-5" />
      </button>

      <Dialog
        open={dialog.isOpen && !locked}
        onClose={dialog.close}
        // A stray click outside must not throw away a half-typed form; Batal is the way out.
        blocking
        title="Ubah password"
        footer={
          <div className="flex w-full flex-col gap-3">
            {change.error && (
              <div className="text-danger text-sm flex items-center flex-row gap-1">
                <TriangleAlertIcon className="size-4" /> {change.error.message}
              </div>
            )}
            <div className="flex gap-3">
              <Button type="submit" form="change-password-form" className="flex-1" loading={change.isPending}>
                Simpan
              </Button>
              <Button variant="outline" className="flex-1" onClick={dialog.close} disabled={change.isPending}>
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <form
          id="change-password-form"
          className="flex flex-col gap-4"
          // Rejections render in the footer; an unhandled one would crash the app.
          onSubmit={handleSubmit(({ currentPassword, newPassword }) =>
            change.mutateAsync({ currentPassword, newPassword }).catch(() => undefined),
          )}
        >
          <PasswordField
            label="Password saat ini"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <PasswordField
            label="Password baru"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordField
            label="Ulangi password baru"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
        </form>
      </Dialog>

      <Dialog
        open={locked}
        onClose={dialog.close}
        blocking
        title={LOCKED_DIALOG.title}
        footer={
          <Button type="button" onClick={dialog.close}>
            {LOCKED_DIALOG.button}
          </Button>
        }
      >
        <p className="text-sm text-ink-secondary">{LOCKED_DIALOG.message}</p>
      </Dialog>
    </>
  );
}
