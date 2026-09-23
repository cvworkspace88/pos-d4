import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { RouterOutputs } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Skeleton } from '@repo/ui/skeleton';
import { Switch } from '@repo/ui/switch';
import { useDialog } from '@repo/hooks/use-dialog';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
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
        dialog.close();
      },
    }),
  );

  // Nothing loaded behind the error, so the page is the failure: no list, and no point offering to
  // add to a list that could not be read.
  const failed = outlets.error && !outlets.data;

  // Declared after `create` on purpose: the two reference each other, and both only run on an
  // event, long after this render finished.
  const dialog = useDialog(() => {
    reset(EMPTY);
    create.reset();
  });

  return (
    <>
      <PageHeader title="Outlet" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {!failed && (
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={dialog.open}>
              <Plus className="mr-1 size-4" aria-hidden />
              Tambah outlet
            </Button>
          </div>
        )}

        <Dialog
          open={dialog.isOpen}
          onClose={dialog.close}
          title="Tambah outlet"
          footer={
            <>
              <Button variant="ghost" onClick={dialog.close} disabled={create.isPending}>
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

        {failed ? (
          // A failed *refetch* is the other branch: it keeps the rows it already has and gets the
          // alert above the table instead.
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout
              tone="danger"
              title="Gagal memuat daftar outlet"
              description={outlets.error.message}
            >
              <Button size="sm" onClick={() => void outlets.refetch()} disabled={outlets.isFetching}>
                {outlets.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
            {outlets.error && (
              <Alert variant="danger" role="alert" className="m-4">
                {outlets.error.message}
              </Alert>
            )}

            <table className="w-full text-sm" aria-busy={outlets.isPending}>
              <thead className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-ink-tertiary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama</th>
                  <th className="px-4 py-3 font-semibold">Kode</th>
                  <th className="px-4 py-3 font-semibold">Alamat</th>
                  <th className="px-4 py-3 font-semibold">Telepon</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {outlets.isPending &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className="border-b border-border-muted last:border-0">
                      {[40, 24, 56, 32, 20, 16].map((w) => (
                        <td key={w} className="px-4 py-3">
                          <Skeleton className="h-4" style={{ width: `${w}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))}

                {outlets.data?.map((o) => (
                  <OutletRow key={o.id} outlet={o} />
                ))}

                {outlets.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-tertiary">
                      Belum ada outlet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}

type Outlet = RouterOutputs['outlet']['list'][number];

function OutletRow({ outlet }: { outlet: Outlet }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const setActive = useMutation(
    trpc.outlet.setActive.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.outlet.list.queryKey() }),
    }),
  );

  return (
    <>
      <tr className={`border-b border-border-muted last:border-0 ${outlet.active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3 font-medium text-ink-primary">{outlet.name}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.code}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.address ?? '—'}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.phone ?? '—'}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              outlet.active ? 'bg-success-light text-success-dark' : 'bg-surface-canvas text-ink-tertiary'
            }`}
          >
            {outlet.active ? 'Aktif' : 'Nonaktif'}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end flex-col items-center gap-2">
            <Switch
              checked={outlet.active}
              disabled={setActive.isPending}
              aria-label={`${outlet.active ? 'Nonaktifkan' : 'Aktifkan'} ${outlet.name}`}
              // tambah onclick show alert dialog.

              
              // A refused toggle leaves `checked` on the server's answer, so the switch springs back
              // on its own once the list refetches; the rejection stays in the row below.
              onCheckedChange={(active) => setActive.mutate({ id: outlet.id, active })}
            />
          </div>
        </td>
      </tr>

      {setActive.error && (
        <tr className="border-b border-border-muted last:border-0">
          <td colSpan={6} className="px-4 pb-3">
            <Alert variant="danger" role="alert">
              {setActive.error.message}
            </Alert>
          </td>
        </tr>
      )}
    </>
  );
}
