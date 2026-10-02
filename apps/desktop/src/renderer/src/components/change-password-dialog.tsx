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

// Mirrors auth.router.ts's changePassword input; the confirmation never leaves the client.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Wajib diisi.'),
    newPassword: z.string().min(8, 'Minimal 8 karakter.').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.confirm === v.newPassword, { path: ['confirm'], message: 'Password tidak sama.' });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { currentPassword: '', newPassword: '', confirm: '' };

/** The `Ubah password` button and its dialog. A wrong current password counts toward the login lock. */
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
        toast.add({ type: 'success', title: 'Password diubah.' });
      },
    }),
  );

  // Declared after the mutation on purpose: each only touches the other from an event.
  const dialog = useDialog(() => {
    reset(EMPTY);
    change.reset();
  });

  // A lock gets the shared dialog instead of the inline error; dismissing it clears the error.
  const locked = isLocked(change.error);

  return (
    <>
      <Button variant="ghost" size="sm" className="flex-1 px-2" onClick={dialog.open}>
        <KeyRound className="mr-1 size-4" aria-hidden />
        Ubah password
      </Button>

      <Dialog
        open={dialog.isOpen && !locked}
        onClose={dialog.close}
        blocking
        closeButton={false}
        title="Ubah password"
        footer={
          <div className="flex w-full flex-col gap-3">
            {change.error && (
              <div role="alert" className="flex flex-row items-center gap-1 text-sm text-danger">
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
          // Rejections render in the footer; an unhandled one would crash the renderer.
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
