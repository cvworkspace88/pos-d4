import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Card } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import { TextField } from '@repo/ui/text-field';
import { PageHeader } from '../components/page-header';
import { SaveBar } from '../components/settings-form';
import { useTRPC } from '../trpc';

/** Deployment-wide settings — every outlet at once, not the active one. Behind `settings.manage`. */
export default function AppSettingsPage() {
  return (
    <>
      <PageHeader title="Pengaturan Aplikasi" subtitle="Berlaku untuk semua outlet" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <AppForm />
      </div>
    </>
  );
}

const minutes = (min: number) =>
  z.coerce
    .number<string>()
    .int('Bilangan bulat.')
    .min(min, `Minimal ${min} menit.`)
    .max(60, 'Maksimal 60 menit.');

const appSchema = z.object({ idle: minutes(1), desktopLock: minutes(0) });

const toMinutes = (seconds: number) => String(Math.round(seconds / 60));
const toValues = (s: { idleTimeoutSeconds: number; desktopLockSeconds: number }) => ({
  idle: toMinutes(s.idleTimeoutSeconds),
  desktopLock: toMinutes(s.desktopLockSeconds),
});

/** The deployment-wide lock timers. PPN lives on each outlet's settings page. */
function AppForm() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.settings.get.queryOptions());
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<z.input<typeof appSchema>, unknown, z.output<typeof appSchema>>({
    resolver: zodResolver(appSchema),
    values: settings.data && toValues(settings.data),
    resetOptions: { keepDirtyValues: true },
  });

  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: (stored) => queryClient.setQueryData(trpc.settings.get.queryKey(), stored),
    }),
  );

  if (settings.isPending) return <Skeleton className="h-32" />;
  if (settings.error)
    return (
      <Alert variant="danger" role="alert">
        {settings.error.message}
      </Alert>
    );

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) =>
          update
            .mutateAsync({ idleTimeoutSeconds: v.idle * 60, desktopLockSeconds: v.desktopLock * 60 })
            .then((stored) => reset(toValues(stored)))
            .catch(() => undefined),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Kunci otomatis tablet (menit)"
            inputMode="numeric"
            helperText="Tablet kembali ke daftar profil setelah tidak disentuh selama ini."
            error={errors.idle?.message}
            {...register('idle')}
          />
          <TextField
            label="Kunci otomatis desktop (menit)"
            inputMode="numeric"
            helperText="0 = mati: desktop hanya dikunci manual."
            error={errors.desktopLock?.message}
            {...register('desktopLock')}
          />
        </div>
        <SaveBar
          pending={update.isPending}
          dirty={isDirty}
          saved={update.isSuccess && !isDirty}
          error={update.error?.message}
        />
      </form>
    </Card>
  );
}
