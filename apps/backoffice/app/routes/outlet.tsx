import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { TextField } from '@repo/ui/text-field';
import { PageHeader } from '../components/page-header';
import { useTRPC } from '../trpc';

// Mirrors outlet.router.ts's create input — the server still validates, this only spares a round trip.
const schema = z.object({
  name: z.string().trim().min(1, 'Wajib diisi.').max(60),
  code: z
    .string()
    .trim()
    .min(1, 'Wajib diisi.')
    .max(12)
    .regex(/^[a-zA-Z0-9-]+$/, 'Huruf, angka, dan tanda hubung saja.'),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(32),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { name: '', code: '', address: '', phone: '' };

/** Every outlet: list, create, edit, deactivate. Not scoped to the active one. */
export default function OutletPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  console.log('trpc', adding);
  const outlets = useQuery(trpc.outlet.list.queryOptions());

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const create = useMutation(
    trpc.outlet.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.outlet.list.queryKey() });
        reset(EMPTY);
        setAdding(false);
      },
    }),
  );

  const close = () => {
    reset(EMPTY);
    create.reset();
    setAdding(false);
  };

  return (
    <>
      <PageHeader title="Outlet" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-tertiary">
            {outlets.data ? `${outlets.data.length} outlet` : 'Memuat…'}
          </span>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 size-4" aria-hidden />
            Tambah outlet
          </Button>
        </div>

        <Dialog
          open={adding}
          onClose={close}
          title="Tambah outlet"
          footer={
            <>
              <Button variant="ghost" onClick={close} disabled={create.isPending}>
                Batal
              </Button>
              <Button type="submit" form="outlet-form" disabled={create.isPending}>
                {create.isPending ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </>
          }
        >
          <form
            id="outlet-form"
            className="flex flex-col gap-4"
            // Rejections render in the alert below; an unhandled one would crash the app.
            onSubmit={handleSubmit((values) =>
              create
                .mutateAsync({
                  name: values.name,
                  code: values.code,
                  // The server treats an omitted field as cleared, so blank must not travel as ''.
                  address: values.address || undefined,
                  phone: values.phone || undefined,
                })
                .catch(() => undefined),
            )}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Nama"
                placeholder="Kafe Melati"
                error={errors.name?.message}
                {...register('name')}
              />
              <TextField
                label="Kode"
                placeholder="MELATI-1"
                error={errors.code?.message}
                {...register('code')}
              />
              <TextField label="Alamat" error={errors.address?.message} {...register('address')} />
              <TextField label="Telepon" error={errors.phone?.message} {...register('phone')} />
            </div>

            {create.error && (
              <Alert variant="danger" role="alert">
                {create.error.message}
              </Alert>
            )}
          </form>
        </Dialog>

        <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
          {outlets.error && (
            <Alert variant="danger" role="alert" className="m-4">
              {outlets.error.message}
            </Alert>
          )}

          <table className="w-full text-sm">
            <thead className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-ink-tertiary">
              <tr>
                <th className="px-4 py-3 font-semibold">Nama</th>
                <th className="px-4 py-3 font-semibold">Kode</th>
                <th className="px-4 py-3 font-semibold">Alamat</th>
                <th className="px-4 py-3 font-semibold">Telepon</th>
              </tr>
            </thead>
            <tbody>
              {outlets.data?.map((o) => (
                <tr key={o.id} className="border-b border-border-muted last:border-0">
                  <td className="px-4 py-3 font-medium text-ink-primary">{o.name}</td>
                  <td className="px-4 py-3 text-ink-secondary">{o.code}</td>
                  <td className="px-4 py-3 text-ink-secondary">{o.address ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-secondary">{o.phone ?? '—'}</td>
                </tr>
              ))}
              {outlets.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-tertiary">
                    Belum ada outlet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
