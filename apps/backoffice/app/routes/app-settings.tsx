import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Card } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import { TextField } from '@repo/ui/text-field';
import { PageHeader } from '../components/page-header';
import { SaveBar, percent, toBp, toPercent } from '../components/settings-form';
import { useTRPC } from '../trpc';

/** Deployment-wide settings — every outlet at once, not the active one. Behind `settings.manage`. */
export default function AppSettingsPage() {
  return (
    <>
      <PageHeader title="Pengaturan Aplikasi" subtitle="Berlaku untuk semua outlet" />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <PpnForm />
      </div>
    </>
  );
}

const ppnSchema = z.object({ ppnRate: percent });

function PpnForm() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.settings.get.queryOptions());
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<z.infer<typeof ppnSchema>>({
    resolver: zodResolver(ppnSchema),
    values: settings.data && { ppnRate: toPercent(settings.data.ppnRateBp) },
    resetOptions: { keepDirtyValues: true },
  });

  const setPpnRate = useMutation(
    trpc.settings.setPpnRate.mutationOptions({
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
          setPpnRate
            .mutateAsync({ ppnRateBp: toBp(v.ppnRate) })
            .then((stored) => reset({ ppnRate: toPercent(stored.ppnRateBp) }))
            .catch(() => undefined),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Tarif PPN efektif (%)"
            inputMode="decimal"
            helperText="Berlaku di semua outlet."
            error={errors.ppnRate?.message}
            {...register('ppnRate')}
          />
        </div>
        <SaveBar
          pending={setPpnRate.isPending}
          dirty={isDirty}
          saved={setPpnRate.isSuccess && !isDirty}
          error={setPpnRate.error?.message}
        />
      </form>
    </Card>
  );
}
