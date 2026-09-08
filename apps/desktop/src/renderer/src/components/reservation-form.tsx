import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { nextFullHourLocal } from '@repo/api-contract';
import { z } from 'zod';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

const schema = z.object({
  customerName: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
  phone: z.string().trim().max(32, 'At most 32 characters.'),
  partySize: z.number({ error: 'Whole number.' }).int().min(1).max(100),
  // Value of <input type="datetime-local">: local wall-clock time, no offset.
  startsAt: z.string().min(1, 'Required.'),
  note: z.string().trim().max(500, 'At most 500 characters.'),
});

type FormValues = z.infer<typeof schema>;

export function ReservationForm({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customerName: '', phone: '', partySize: 2, startsAt: nextFullHourLocal(), note: '' },
  });

  const create = useMutation(
    trpc.reservation.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
        onClose();
      },
    }),
  );

  const submit = ({ customerName, phone, partySize, startsAt, note }: FormValues) =>
    create
      .mutateAsync({
        tableId: table.id,
        customerName,
        phone: phone || undefined,
        partySize,
        startsAt: new Date(startsAt).toISOString(),
        note: note || undefined,
      })
      .catch(() => undefined);

  return (
    <dialog open>
      <form onSubmit={handleSubmit(submit)}>
        <h3>Reserve {table.name}</h3>

        <label htmlFor="res-name">Customer</label>
        <input id="res-name" type="text" {...register('customerName')} />
        {errors.customerName && <p role="alert">{errors.customerName.message}</p>}

        <label htmlFor="res-phone">Phone</label>
        <input id="res-phone" type="tel" {...register('phone')} />
        {errors.phone && <p role="alert">{errors.phone.message}</p>}

        <label htmlFor="res-party">Party size</label>
        <input id="res-party" type="number" min={1} max={100} {...register('partySize', { valueAsNumber: true })} />
        {errors.partySize && <p role="alert">{errors.partySize.message}</p>}

        <label htmlFor="res-time">Time</label>
        <input id="res-time" type="datetime-local" {...register('startsAt')} />
        {errors.startsAt && <p role="alert">{errors.startsAt.message}</p>}

        <label htmlFor="res-note">Note</label>
        <input id="res-note" type="text" {...register('note')} />
        {errors.note && <p role="alert">{errors.note.message}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Reserve'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
    </dialog>
  );
}
