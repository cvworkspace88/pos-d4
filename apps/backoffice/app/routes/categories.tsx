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
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
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
  const refetch = () => queryClient.invalidateQueries({ queryKey: listKey });

  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);

  const create = useMutation(
    trpc.category.create.mutationOptions({
      onSuccess: () => {
        setName('');
        void refetch();
      },
      onError: () => void refetch(),
    }),
  );
  const rename = useMutation(
    trpc.category.rename.mutationOptions({
      onSuccess: () => {
        setRenaming(null);
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
      onSuccess: (saved) => queryClient.setQueryData(listKey, saved),
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

  const failed = list.error && !list.data;
  const actionError = create.error ?? reorder.error;

  return (
    <>
      <PageHeader title="Kategori" subtitle={outlet?.name ?? 'Belum ada outlet aktif'} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {canEdit && !failed && (
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate({ name: name.trim() });
            }}
          >
            <div className="w-72">
              <TextField
                aria-label="Nama kategori baru"
                placeholder="Nama kategori baru"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" loading={create.isPending} disabled={!outlet || !name.trim()}>
              Tambah kategori
            </Button>
          </form>
        )}

        {actionError && (
          <Alert variant="danger" role="alert">
            {actionError.message}
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
              <StateMessageLayout
                title="Belum ada kategori"
                description={canEdit ? 'Tambahkan kategori pertama di atas.' : undefined}
              />
            )}

            {list.data && list.data.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={list.data.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  <ul>
                    {list.data.map((c) => (
                      <CategoryRow
                        key={c.id}
                        category={c}
                        canEdit={canEdit}
                        onRename={() => {
                          rename.reset();
                          setNewName(c.name);
                          setRenaming(c);
                        }}
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
        open={!!renaming}
        onClose={() => setRenaming(null)}
        blocking={rename.isPending}
        closeButton={false}
        title="Ganti nama kategori"
        footer={
          <div className="flex w-full flex-col gap-3">
            {rename.error && <p className="text-sm text-danger">{rename.error.message}</p>}
            <div className="flex gap-3">
              <Button
                className="flex-1"
                loading={rename.isPending}
                disabled={!newName.trim() || newName.trim() === renaming?.name}
                onClick={() => renaming && rename.mutate({ id: renaming.id, name: newName.trim() })}
              >
                Simpan
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setRenaming(null)}
                disabled={rename.isPending}
              >
                Batal
              </Button>
            </div>
          </div>
        }
      >
        <TextField label="Nama" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} />
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
        <p className="text-sm text-ink-secondary">Kategori ini tidak lagi tampil di layar kasir.</p>
      </Dialog>
    </>
  );
}

function CategoryRow({
  category,
  canEdit,
  onRename,
  onRemove,
}: {
  category: Category;
  canEdit: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id, disabled: !canEdit });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-border-muted bg-surface px-4 py-3 text-sm last:border-0 ${
        isDragging ? 'relative z-10 shadow-md' : ''
      }`}
    >
      {canEdit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Geser ${category.name}`}
          className="flex size-8 cursor-grab touch-none items-center justify-center rounded text-ink-tertiary hover:bg-primary-lighter active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <span className="flex-1 truncate font-medium text-ink-primary">{category.name}</span>
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
