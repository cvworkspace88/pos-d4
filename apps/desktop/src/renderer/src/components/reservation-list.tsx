import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RouterOutputs } from '@repo/api-contract';
import { useTRPC } from '../trpc';
import type { FloorTable } from './floor-plan';

export type FloorReservationRow = RouterOutputs['reservation']['list'][number];

const ACTIONS = [
  ['seated', 'Seat'],
  ['no_show', 'No-show'],
  ['cancelled', 'Cancel'],
] as const;

export function ReservationList({
  reservations,
  tables,
  canUpdate,
}: {
  reservations: FloorReservationRow[];
  tables: FloorTable[];
  canUpdate: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const update = useMutation(
    trpc.reservation.update.mutationOptions({
      // Settled, not success: a PRECONDITION_FAILED means someone else already resolved it.
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() }),
    }),
  );

  const nameOf = (tableId: string) => tables.find((t) => t.id === tableId)?.name ?? '?';
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section>
      <h3>Today&apos;s reservations</h3>
      {reservations.length === 0 && <p>None.</p>}
      <ul>
        {reservations.map((r) => (
          <li key={r.id}>
            {timeOf(r.startsAt)} · {nameOf(r.tableId)} · {r.customerName} × {r.partySize} · {r.status}
            {r.status === 'booked' &&
              canUpdate &&
              ACTIONS.map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  disabled={update.isPending}
                  style={{ marginLeft: 6 }}
                  onClick={() => update.mutate({ id: r.id, status })}
                >
                  {label}
                </button>
              ))}
          </li>
        ))}
      </ul>
      {update.error && <p role="alert">{update.error.message}</p>}
    </section>
  );
}
