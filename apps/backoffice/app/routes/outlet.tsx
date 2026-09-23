import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, LoaderCircle, Plus, TriangleAlertIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { RouterOutputs } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Pill } from '@repo/ui/pill';
import { Skeleton } from '@repo/ui/skeleton';
import { Switch } from '@repo/ui/switch';
import { useDialog } from '@repo/hooks/use-dialog';
import { useSpinDelay } from '@repo/hooks/use-spin-delay';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { TextField } from '@repo/ui/text-field';
import { Tooltip } from '@repo/ui/tooltip';
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
      onSuccess: () => confirm.close(),
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.outlet.list.queryKey() }),
    }),
  );
  const isSwitching =
    useSpinDelay(setActive.isPending, { delay: 0, minDuration: 400 }) || setActive.isPending;

  // Declared after `setActive` for the same reason as the create dialog above: each is only
  // touched from an event.
  const confirm = useDialog();
  // Backing out clears the attempt's error; a success closes with `confirm.close` alone, so its
  // check still shows beside the switch.
  const cancel = () => {
    confirm.close();
    setActive.reset();
  };

  // The check is a moment's acknowledgement, not a state: it goes once seen, counted from when it
  // appears. A new toggle flips `isSuccess` off first, and the cleanup drops the pending reset.
  const { isSuccess, reset } = setActive;
  const showCheck = isSuccess && !isSwitching;
  useEffect(() => {
    if (!showCheck) return;
    const timer = setTimeout(reset, 1500);
    return () => clearTimeout(timer);
  }, [showCheck, reset]);

  const deactivate = () => setActive.mutateAsync({ id: outlet.id, active: false }).catch(() => undefined);

  return (
    <>
      <tr className={`border-b border-border-muted last:border-0 ${outlet.active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3 font-medium text-ink-primary">{outlet.name}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.code}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.address ?? '—'}</td>
        <td className="px-4 py-3 text-ink-secondary">{outlet.phone ?? '—'}</td>
        <td className="px-4 py-3">
          <Pill tone={outlet.active ? 'success' : 'neutral'} className="w-20">
            {outlet.active ? 'Aktif' : 'Nonaktif'}
          </Pill>
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end flex-row items-center gap-2">
            <Switch
              checked={outlet.active}
              disabled={isSwitching}
              aria-label={`${outlet.active ? 'Nonaktifkan' : 'Aktifkan'} ${outlet.name}`}
              onCheckedChange={(active) =>
                // A failed reopen's error would otherwise greet the dialog above `Tutup`.
                active ? setActive.mutate({ id: outlet.id, active }) : (setActive.reset(), confirm.open())
              }
            />
            {/* A live region, so a screen reader hears saving, saved and failed as they happen. */}
            <span role="status" className="mr-2 flex size-4 items-center justify-center">
              {isSwitching && (
                <>
                  <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
                  <span className="sr-only">Menyimpan</span>
                </>
              )}
              {showCheck && (
                <>
                  <CircleCheck className="size-4 text-success" aria-hidden />
                  <span className="sr-only">Tersimpan</span>
                </>
              )}
              {setActive.error && !isSwitching && !confirm.isOpen && (
                <Tooltip delay={100} content={setActive.error.message} aria-label={setActive.error.message}>
                  <CircleAlert className="size-4 text-danger" aria-hidden />
                </Tooltip>
              )}
            </span>
          </div>
        </td>
      </tr>

      <Dialog
        open={confirm.isOpen}
        onClose={cancel}
        blocking={setActive.isPending}
        // `blocking` would drop the X mid-save and jump the header; `Batal` is the way out.
        closeButton={false}
        title="Tutup outlet?"
        footer={
          <div className="flex w-full flex-col gap-3">
            {setActive.error && (
              <div className="text-danger text-sm flex items-center flex-row gap-1">
                <TriangleAlertIcon className="size-4" /> {setActive.error.message}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="danger" className="flex-1" loading={setActive.isPending} onClick={deactivate}>
                Tutup
              </Button>
              <Button variant="outline" className="flex-1" onClick={cancel} disabled={setActive.isPending}>
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">{outlet.name}</span> akan dinonaktifkan.
        </p>
      </Dialog>
    </>
  );
}
