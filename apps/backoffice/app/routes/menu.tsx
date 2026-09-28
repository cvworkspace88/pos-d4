import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Pill } from '@repo/ui/pill';
import { Select } from '@repo/ui/select';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { Switch } from '@repo/ui/switch';
import { TextField } from '@repo/ui/text-field';
import { MenuItemDrawer, type MenuItem, type MenuItemFields } from '../components/menu-item-drawer';
import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/** The active outlet's menu. Everyone with `menu.view` reads it; `menu.manage` adds and edits. */
export default function MenuPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const outlet = useAuthStore((s) => s.outlet);
  const me = useQuery(trpc.auth.me.queryOptions());
  const canManage = me.data?.permissions.includes('menu.manage') ?? false;

  const listKey = trpc.menu.list.queryKey();
  const list = useQuery(trpc.menu.list.queryOptions(undefined, { enabled: !!outlet }));
  // Only the drawer needs the full category list, and only a manager opens it.
  const categories = useQuery(trpc.category.list.queryOptions(undefined, { enabled: !!outlet && canManage }));
  const taxRates = useQuery(trpc.menu.taxRates.queryOptions(undefined, { enabled: !!outlet && canManage }));
  const addonGroups = useQuery(trpc.addon.list.queryOptions(undefined, { enabled: !!outlet && canManage }));
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    // Add-on groups show "Dipakai di N menu"; keep that count fresh after a menu save/delete.
    void queryClient.invalidateQueries({ queryKey: trpc.addon.list.queryKey() });
    // The category page shows how many menu items each category holds.
    void queryClient.invalidateQueries({ queryKey: trpc.category.list.queryKey() });
  };

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  // `null` closed, `'new'` adding, an item editing it.
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<MenuItem | null>(null);

  const onSaved = () => {
    setEditing(null);
    void refetch();
  };
  const create = useMutation(
    trpc.menu.create.mutationOptions({ onSuccess: onSaved, onError: () => void refetch() }),
  );
  const update = useMutation(
    trpc.menu.update.mutationOptions({ onSuccess: onSaved, onError: () => void refetch() }),
  );
  // Optimistic: the switch moves at once. On failure the list is refetched, which puts it back.
  const setAvailable = useMutation(
    trpc.menu.setAvailable.mutationOptions({
      onMutate: async ({ id, available }) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        queryClient.setQueryData(listKey, (items) =>
          items?.map((item) => (item.id === id ? { ...item, available } : item)),
        );
      },
      onSettled: () => void refetch(),
    }),
  );

  const remove = useMutation(
    trpc.menu.delete.mutationOptions({
      onSuccess: () => {
        setRemoving(null);
        void refetch();
      },
      onError: () => void refetch(),
    }),
  );

  const openDrawer = (target: MenuItem | 'new') => {
    create.reset();
    update.reset();
    setEditing(target);
  };
  const save = (fields: MenuItemFields) =>
    editing === 'new' ? create.mutate(fields) : editing && update.mutate({ id: editing.id, ...fields });

  // The filter offers the categories that have items, in the list's own (cashier screen) order.
  const items = list.data ?? [];
  const filterItems = [
    { value: 'all', label: 'Semua kategori' },
    ...[...new Map(items.map((m) => [m.categoryId, m.categoryName]))].map(([value, label]) => ({
      value,
      label,
    })),
  ];
  const q = query.trim().toLowerCase();
  const rows = items.filter(
    (m) =>
      (filter === 'all' || m.categoryId === filter) &&
      (!q || m.name.toLowerCase().includes(q) || m.code?.toLowerCase().includes(q)),
  );

  const failed = list.error && !list.data;

  return (
    <>
      <PageHeader title="Menu" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {!failed && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72">
              <TextField
                aria-label="Cari menu"
                placeholder="Cari nama atau kode menu"
                adornment={<Search className="size-4 text-ink-tertiary" aria-hidden />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-48">
              <Select
                aria-label="Filter kategori"
                items={filterItems}
                value={filter}
                onValueChange={setFilter}
              />
            </div>
            {canManage && (
              <Button className="ml-auto" onClick={() => openDrawer('new')} disabled={!outlet}>
                <Plus className="mr-2 size-4" aria-hidden />
                Tambah menu
              </Button>
            )}
          </div>
        )}

        {setAvailable.error && (
          <Alert variant="danger" role="alert">
            {setAvailable.error.message}
          </Alert>
        )}

        {failed ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout tone="danger" title="Gagal memuat menu" description={list.error.message}>
              <Button size="sm" onClick={() => void list.refetch()} disabled={list.isFetching}>
                {list.isFetching ? 'Memuat…' : 'Coba lagi'}
              </Button>
            </StateMessageLayout>
          </Card>
        ) : (
          <Card className="min-h-0 flex-1 overflow-auto !gap-0 !p-0">
            {list.isPending &&
              outlet &&
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="border-b border-border-muted px-4 py-3 last:border-0">
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}

            {list.data && rows.length === 0 && (
              <StateMessageLayout
                title={items.length ? 'Menu tidak ditemukan' : 'Belum ada menu'}
                description={
                  items.length
                    ? 'Ubah kata kunci atau filter kategori.'
                    : canManage
                      ? 'Tambahkan menu pertama.'
                      : undefined
                }
              />
            )}

            {rows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-canvas text-left text-xs uppercase tracking-wider text-ink-tertiary">
                  <tr>
                    <th className="w-24 px-4 py-3 font-semibold">Kode</th>
                    <th className="px-4 py-3 font-semibold">Nama</th>
                    <th className="px-4 py-3 font-semibold">Kategori</th>
                    <th className="px-4 py-3 text-right font-semibold">Harga</th>
                    {canManage && <th className="px-4 py-3 text-right font-semibold">Harga modal</th>}
                    <th className="w-36 whitespace-nowrap px-4 py-3 font-semibold">Tersedia</th>
                    {canManage && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-b border-border-muted last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{m.code ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-ink-primary">{m.name}</span>
                        {(m.variants.length > 0 || m.addonGroupIds.length > 0) && (
                          <span className="block text-xs text-ink-tertiary">
                            {[
                              m.variants.length && `${m.variants.length} varian`,
                              m.addonGroupIds.length && `${m.addonGroupIds.length} add-on`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{m.categoryName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-primary">
                        {m.variants.length ? `Mulai ${rupiah(m.price)}` : rupiah(m.price)}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                          {m.variants.length ? 'Per varian' : m.cost === null ? '—' : rupiah(m.cost)}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={`${m.name} tersedia`}
                            checked={m.available}
                            disabled={!canManage}
                            onCheckedChange={(available) => setAvailable.mutate({ id: m.id, available })}
                          />
                          {!m.available && <Pill tone="danger">Habis</Pill>}
                        </div>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Ubah ${m.name}`}
                              onClick={() => openDrawer(m)}
                            >
                              <Pencil className="size-4 text-primary" aria-hidden />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Hapus ${m.name}`}
                              onClick={() => {
                                remove.reset();
                                setRemoving(m);
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

      <MenuItemDrawer
        target={editing}
        categories={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        addonGroups={addonGroups.data ?? []}
        addonGroupsLoading={addonGroups.isLoading}
        onClose={() => setEditing(null)}
        onSave={save}
        saving={create.isPending || update.isPending}
        error={(create.error ?? update.error)?.message}
        rates={{ pbjt: taxRates.data?.pbjtRateBp, ppn: taxRates.data?.ppnRateBp }}
      />

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        blocking={remove.isPending}
        closeButton={false}
        title={`Hapus menu ${removing?.name ?? ''}?`}
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
          Menu ini tidak lagi tampil di layar kasir. Pesanan lama tetap menyimpan namanya.
        </p>
      </Dialog>
    </>
  );
}
