import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describeRule } from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { AddonGroupDrawer, type AddonGroup, type AddonGroupFields } from '../components/addon-group-drawer';
import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

/** The active outlet's shared add-on groups. `menu.view` reads; `menu.manage` adds and edits. */
export default function AddonsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const outlet = useAuthStore((s) => s.outlet);
  const me = useQuery(trpc.auth.me.queryOptions());
  const canManage = me.data?.permissions.includes('menu.manage') ?? false;

  const list = useQuery(trpc.addon.list.queryOptions(undefined, { enabled: !!outlet }));
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.addon.list.queryKey() });
    // The menu drawer's add-on checkboxes and "Dipakai di N menu" read menu.list; keep it fresh too.
    void queryClient.invalidateQueries({ queryKey: trpc.menu.list.queryKey() });
  };

  const [editing, setEditing] = useState<AddonGroup | 'new' | null>(null);
  const [removing, setRemoving] = useState<AddonGroup | null>(null);

  const onSaved = () => {
    setEditing(null);
    void refetch();
  };
  const create = useMutation(
    trpc.addon.create.mutationOptions({ onSuccess: onSaved, onError: () => void refetch() }),
  );
  const update = useMutation(
    trpc.addon.update.mutationOptions({ onSuccess: onSaved, onError: () => void refetch() }),
  );
  const remove = useMutation(
    trpc.addon.delete.mutationOptions({
      onSuccess: () => {
        setRemoving(null);
        void refetch();
      },
      onError: () => void refetch(),
    }),
  );

  const openDrawer = (target: AddonGroup | 'new') => {
    create.reset();
    update.reset();
    setEditing(target);
  };
  const save = (fields: AddonGroupFields) =>
    editing === 'new' ? create.mutate(fields) : editing && update.mutate({ id: editing.id, ...fields });

  const groups = list.data ?? [];
  const failed = list.error && !list.data;

  return (
    <>
      <PageHeader title="Add-on" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {canManage && !failed && (
          <div className="flex">
            <Button className="ml-auto" onClick={() => openDrawer('new')} disabled={!outlet}>
              <Plus className="mr-2 size-4" aria-hidden />
              Tambah add-on
            </Button>
          </div>
        )}

        {failed ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout tone="danger" title="Gagal memuat add-on" description={list.error.message}>
              <Button size="sm" onClick={() => void list.refetch()} disabled={list.isFetching}>
                {list.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
            {list.isPending &&
              outlet &&
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="border-b border-border-muted px-4 py-3 last:border-0">
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}

            {list.data && groups.length === 0 && (
              <StateMessageLayout
                title="Belum ada add-on"
                description={canManage ? 'Contoh: Level Pedas, Topping, Ukuran gula.' : undefined}
              />
            )}

            {groups.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-canvas text-left text-xs uppercase tracking-wider text-ink-tertiary">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Nama</th>
                    <th className="px-4 py-3 font-semibold">Aturan</th>
                    <th className="px-4 py-3 text-right font-semibold">Pilihan</th>
                    <th className="px-4 py-3 text-right font-semibold">Dipakai</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-b border-border-muted last:border-0">
                      <td className="px-4 py-3 font-medium text-ink-primary">{g.name}</td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {describeRule(g.minSelect, g.maxSelect)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                        {g.options.length}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                        {g.usedBy} menu
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Ubah ${g.name}`}
                              onClick={() => openDrawer(g)}
                            >
                              <Pencil className="size-4 text-primary" aria-hidden />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Hapus ${g.name}`}
                              onClick={() => {
                                remove.reset();
                                setRemoving(g);
                              }}
                            >
                              <Trash2 className="size-4 text-danger" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>

      <AddonGroupDrawer
        target={editing}
        onClose={() => setEditing(null)}
        onSave={save}
        saving={create.isPending || update.isPending}
        error={(create.error ?? update.error)?.message}
      />

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        blocking={remove.isPending}
        closeButton={false}
        title={`Hapus add-on ${removing?.name ?? ''}?`}
        footer={
          <div className="flex w-full flex-col gap-3">
            {remove.error && <p className="text-sm text-danger">{remove.error.message}</p>}
            <div className="flex gap-3">
              <Button
                variant="danger"
                className="flex-1"
                loading={remove.isPending}
                onClick={() => removing && remove.mutate({ id: removing.id })}
              >
                Hapus
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setRemoving(null)}
                disabled={remove.isPending}
              >
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <p className="text-sm text-ink-secondary">
          {removing?.usedBy
            ? `Dipakai di ${removing.usedBy} menu. Add-on ini akan dilepas dari semua menu tersebut.`
            : 'Add-on ini belum dipakai di menu mana pun.'}
        </p>
      </Dialog>
    </>
  );
}
