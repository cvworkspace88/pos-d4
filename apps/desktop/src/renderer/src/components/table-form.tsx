import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

// Mirrors the API's zod bounds; duplicated because the renderer cannot import from apps/api.
const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(20, 'At most 20 characters.'),
  seats: z.number({ error: 'Whole number.' }).int().min(1).max(50),
  w: z.number({ error: 'Whole number.' }).int().min(40).max(500),
  h: z.number({ error: 'Whole number.' }).int().min(40).max(500),
});

type FormValues = z.infer<typeof schema>;

/** Create (table null) or edit + delete. A new table lands at 50,50; the manager drags it from there. */
export function TableForm({
  table,
  canDelete,
  onClose,
}: {
  table: FloorTable | null;
  canDelete: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.table.list.queryKey() });
    onClose();
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: table
      ? { name: table.name, seats: table.seats, w: table.w, h: table.h }
      : { name: '', seats: 4, w: 100, h: 100 },
  });

  const create = useMutation(trpc.table.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.table.update.mutationOptions());
  const updateLayout = useMutation(trpc.table.updateLayout.mutationOptions());
  const remove = useMutation(trpc.table.delete.mutationOptions({ onSuccess: done }));

  const error = create.error ?? update.error ?? updateLayout.error ?? remove.error;
  const pending = create.isPending || update.isPending || updateLayout.isPending || remove.isPending;

  const submit = async ({ name, seats, w, h }: FormValues) => {
    if (!table) {
      await create.mutateAsync({ name, seats, w, h, x: 50, y: 50 }).catch(() => undefined);
      return;
    }
    try {
      await update.mutateAsync({ id: table.id, name, seats });
      if (w !== table.w || h !== table.h)
        await updateLayout.mutateAsync({ items: [{ id: table.id, x: table.x, y: table.y, w, h }] });
      done();
    } catch {
      // Shown through `error` below; the form stays open.
    }
  };

  return (
    <dialog open>
      <form onSubmit={handleSubmit(submit)}>
        <h3>{table ? `Edit ${table.name}` : 'New table'}</h3>

        <label htmlFor="table-name">Name</label>
        <input id="table-name" type="text" {...register('name')} />
        {errors.name && <p role="alert">{errors.name.message}</p>}

        <label htmlFor="table-seats">Seats</label>
        <input id="table-seats" type="number" min={1} max={50} {...register('seats', { valueAsNumber: true })} />
        {errors.seats && <p role="alert">{errors.seats.message}</p>}

        <label htmlFor="table-w">Width</label>
        <input id="table-w" type="number" min={40} max={500} {...register('w', { valueAsNumber: true })} />
        {errors.w && <p role="alert">{errors.w.message}</p>}

        <label htmlFor="table-h">Height</label>
        <input id="table-h" type="number" min={40} max={500} {...register('h', { valueAsNumber: true })} />
        {errors.h && <p role="alert">{errors.h.message}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {table && canDelete && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete ${table.name}?`)) remove.mutate({ id: table.id });
              }}
            >
              Delete
            </button>
          )}
        </div>
        {error && <p role="alert">{error.message}</p>}
      </form>
    </dialog>
  );
}
