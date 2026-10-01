import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { RouterOutputs } from '@repo/api-contract';
import { Alert } from '@repo/ui/alert';
import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';
import { Dialog } from '@repo/ui/dialog';
import { Skeleton } from '@repo/ui/skeleton';
import { StateMessageLayout } from '@repo/ui/state-message-layout';
import { TextField } from '@repo/ui/text-field';
import { PageHeader } from '../components/page-header';
import { useAuthStore } from '../stores/auth';
import { useTRPC } from '../trpc';

type Category = RouterOutputs['category']['list'][number];

/** The active outlet's menu categories, in the order the cashier screen shows them. Drag to reorder. */
export default function CategoriesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const outlet = useAuthStore((s) => s.outlet);
  const me = useQuery(trpc.auth.me.queryOptions());
  const canEdit = me.data?.permissions.includes('category.edit') ?? false;

  const listKey = trpc.category.list.queryKey();
  const list = useQuery(trpc.category.list.queryOptions(undefined, { enabled: !!outlet }));
  // The Menu drawer's category picker reads menu.list, so it goes stale with this list.
  const refetch = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: trpc.menu.list.queryKey() }),
    ]);

  const [query, setQuery] = useState('');
  // 'new' adds a category; a row renames it. One dialog, so both flows look the same.
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const create = useMutation(
    trpc.category.create.mutationOptions({
      onSuccess: async (saved) => {
        setEditing(null);
        await refetch();
        // New categories land at the end: show the user where it went.
        setHighlighted(saved.id);
        document
          .getElementById(`category-${saved.id}`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(() => setHighlighted((id) => (id === saved.id ? null : id)), 2000);
      },
      onError: () => void refetch(),
    }),
  );
  const rename = useMutation(
    trpc.category.update.mutationOptions({
      onSuccess: () => {
        setEditing(null);
        void refetch();
      },
      onError: () => void refetch(),
    }),
  );
  const remove = useMutation(
    trpc.category.delete.mutationOptions({
      onSuccess: () => {
        setRemoving(null);
        void refetch();
      },
      onError: () => void refetch(),
    }),
  );
  // Optimistic: the row stays where it was dropped. On failure the old order comes back and the
  // list is refetched, since every reorder error means "the list changed elsewhere".
  const reorder = useMutation(
    trpc.category.reorder.mutationOptions({
      onMutate: async ({ ids }) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous = queryClient.getQueryData<Category[]>(listKey);
        const byId = new Map(previous?.map((c) => [c.id, c]));
        queryClient.setQueryData(
          listKey,
          ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder })),
        );
        return { previous };
      },
      onError: (_error, _input, context) => {
        queryClient.setQueryData(listKey, context?.previous);
        void refetch();
      },
      // The reply carries the saved order but not the item counts, so keep the counts already on hand.
      onSuccess: (saved) =>
        queryClient.setQueryData(listKey, (old) =>
          saved.map((c) => ({ ...c, itemCount: old?.find((o) => o.id === c.id)?.itemCount ?? 0 })),
        ),
    }),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const rows = list.data;
    if (!rows || !over || active.id === over.id) return;
    const from = rows.findIndex((c) => c.id === active.id);
    const to = rows.findIndex((c) => c.id === over.id);
    reorder.mutate({ ids: arrayMove(rows, from, to).map((c) => c.id) });
  };

  const openDialog = (target: Category | 'new') => {
    create.reset();
    rename.reset();
    setDraftName(target === 'new' ? '' : target.name);
    setEditing(target);
  };

  const saving = create.isPending || rename.isPending;
  const saveError = create.error ?? rename.error;
  const trimmed = draftName.trim();
  const unchanged = editing !== 'new' && trimmed === editing?.name;
  const save = () => {
    if (!editing || !trimmed || unchanged) return;
    if (editing === 'new') create.mutate({ name: trimmed });
    else
      rename.mutate({
        id: editing.id,
        name: trimmed,
        // The dialog edits the name only; the rest rides along unchanged (a full-set save).
        color: editing.color,
        active: editing.active,
        kitchenStationId: editing.kitchenStationId,
      });
  };

  const q = query.trim().toLowerCase();
  const rows = q ? (list.data ?? []).filter((c) => c.name.toLowerCase().includes(q)) : (list.data ?? []);
  // Reordering a filtered list is ambiguous, so dragging waits for the search to be cleared.
  const canDrag = canEdit && !q;
  const failed = list.error && !list.data;

  return (
    <>
      <PageHeader title="Kategori" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {!failed && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-72">
              <TextField
                aria-label="Cari kategori"
                placeholder="Cari kategori"
                prefix={<Search className="size-4 text-ink-tertiary" aria-hidden />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {canEdit && (
              <Button size="sm" className="ml-auto" onClick={() => openDialog('new')} disabled={!outlet}>
                <Plus className="mr-2 size-4" aria-hidden />
                Tambah kategori
              </Button>
            )}
          </div>
        )}

        {q && canEdit && list.data && list.data.length > 0 && (
          <p className="text-xs text-ink-tertiary">Hapus pencarian untuk mengatur urutan.</p>
        )}

        {reorder.error && (
          <Alert variant="danger" role="alert">
            {reorder.error.message}
          </Alert>
        )}

        {failed ? (
          <Card className="min-h-0 flex-1 items-center justify-center">
            <StateMessageLayout tone="danger" title="Gagal memuat kategori" description={list.error.message}>
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

            {list.data?.length === 0 && (
              <StateMessageLayout title="Belum ada kategori">
                {canEdit && (
                  <Button size="sm" onClick={() => openDialog('new')}>
                    <Plus className="mr-2 size-4" aria-hidden />
                    Tambah kategori
                  </Button>
                )}
              </StateMessageLayout>
            )}

            {list.data && list.data.length > 0 && rows.length === 0 && (
              <StateMessageLayout title="Tidak ada kategori yang cocok." />
            )}

            {rows.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  <ul>
                    {rows.map((c) => (
                      <CategoryRow
                        key={c.id}
                        category={c}
                        canEdit={canEdit}
                        canDrag={canDrag}
                        highlighted={highlighted === c.id}
                        onRename={() => openDialog(c)}
                        onRemove={() => {
                          remove.reset();
                          setRemoving(c);
                        }}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </Card>
        )}
      </div>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        blocking={saving}
        closeButton={false}
        title={editing === 'new' ? 'Kategori baru' : 'Ganti nama kategori'}
        footer={
          <div className="flex w-full gap-3">
            <Button
              type="submit"
              form="category-form"
              className="flex-1"
              loading={saving}
              disabled={!trimmed || unchanged}
            >
              Simpan
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setEditing(null)} disabled={saving}>
              Batal
            </Button>
          </div>
        }
      >
        <form
          id="category-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <TextField
            label="Nama kategori"
            maxLength={40}
            value={draftName}
            // A duplicate name keeps what was typed, so the user only has to fix it.
            error={saveError?.message}
            onChange={(e) => setDraftName(e.target.value)}
          />
        </form>
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        blocking={remove.isPending}
        closeButton={false}
        title={`Hapus kategori ${removing?.name ?? ''}?`}
        footer={
          <div className="flex w-full flex-col gap-3">
            {remove.error && <p className="text-sm text-danger">{remove.error.message}</p>}
            <div className="flex gap-3">
              <Button
                variant="danger"
                className="flex-1"
                loading={remove.isPending}
                // The server refuses anyway; the count may be stale, so it still has the last word.
                disabled={!!removing?.itemCount}
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
          {removing?.itemCount
            ? `Masih berisi ${removing.itemCount} menu. Pindahkan menu ke kategori lain dulu.`
            : 'Kategori ini tidak lagi tampil di layar kasir.'}
        </p>
      </Dialog>
    </>
  );
}

function CategoryRow({
  category,
  canEdit,
  canDrag,
  highlighted,
  onRename,
  onRemove,
}: {
  category: Category;
  canEdit: boolean;
  /** Off while searching: the grip stays in place so rows don't shift, but it is inert. */
  canDrag: boolean;
  /** Briefly marks a just-added row. */
  highlighted: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id, disabled: !canDrag });

  return (
    <li
      ref={setNodeRef}
      id={`category-${category.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-border-muted px-4 py-3 text-sm transition-colors duration-700 last:border-0 ${
        highlighted ? 'bg-primary-lighter' : 'bg-surface'
      } ${isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      {canEdit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Geser ${category.name}`}
          disabled={!canDrag}
          className="flex size-8 cursor-grab touch-none items-center justify-center rounded text-ink-tertiary hover:bg-primary-lighter active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <span className="flex-1 truncate font-medium text-ink-primary">{category.name}</span>
      <span className="shrink-0 tabular-nums text-ink-tertiary">{category.itemCount} menu</span>
      {canEdit && (
        <div className="flex gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Ganti nama ${category.name}`}
            onClick={onRename}
          >
            <Pencil className="size-4 text-primary" aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Hapus ${category.name}`} onClick={onRemove}>
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}
