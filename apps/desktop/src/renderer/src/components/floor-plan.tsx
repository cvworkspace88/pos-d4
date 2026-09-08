import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  clampPosition,
  dayRange,
  groupsOf,
  isReserved,
  scaleFor,
  seatsOf,
  type RouterOutputs,
} from '@repo/api-contract';
import { useTRPC } from '../trpc';
import { ReservationForm } from './reservation-form';
import { ReservationList } from './reservation-list';
import { TableForm } from './table-form';

export type FloorTable = RouterOutputs['table']['list'][number];
type Position = { x: number; y: number };

/** Group outline colour keyed by the head id, so a group keeps its colour across refetches. */
export const groupColor = (headId: string | null) =>
  headId ? `hsl(${parseInt(headId.slice(0, 6), 16) % 360}, 70%, 45%)` : '#999';

function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Re-renders once a minute so the "Reserved" badge appears on time without a refetch. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

export function FloorPlan({ permissions }: { permissions: string[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({ ...trpc.table.list.queryOptions(), refetchInterval: 30_000 });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const now = useNow();
  const reservationsQuery = useQuery({
    ...trpc.reservation.list.queryOptions(dayRange(now)),
    enabled: can('reservation.view'),
    refetchInterval: 30_000,
  });
  const reservations = reservationsQuery.data ?? [];

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FloorTable | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ headId: string; memberIds: string[] } | null>(null);
  const [reserving, setReserving] = useState<FloorTable | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables being dragged or awaiting the server's answer. Kept outside the query
  // cache so a 30 s refetch landing mid-drag cannot yank a table back under the pointer.
  const [override, setOverride] = useState<Record<string, Position>>({});
  const dragRef = useRef<{ id: string; offset: Position; start: Position; moved: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(containerRef);
  const scale = scaleFor(width, height);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
  };
  const fail = (error: { message: string }) => {
    setMessage(error.message);
    invalidate();
  };
  const release = (id: string) =>
    setOverride((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });

  const updateLayout = useMutation(
    trpc.table.updateLayout.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, (old) => old?.map((t) => rows.find((r) => r.id === t.id) ?? t));
        rows.forEach((r) => release(r.id));
      },
      onError: (error, input) => {
        input.items.forEach((item) => release(item.id));
        fail(error);
      },
    }),
  );
  const merge = useMutation(
    trpc.table.merge.mutationOptions({
      onSuccess: (rows) => {
        queryClient.setQueryData(listKey, rows);
        setPicking(null);
      },
      onError: fail,
    }),
  );
  const unmerge = useMutation(
    trpc.table.unmerge.mutationOptions({
      onSuccess: (rows) => queryClient.setQueryData(listKey, rows),
      onError: fail,
    }),
  );

  const positionOf = (t: FloorTable): Position => override[t.id] ?? { x: t.x, y: t.y };
  const isStandalone = (t: FloorTable) => !t.mergedIntoId && !groups.has(t.id);
  const nameOf = (id: string) => tables.find((t) => t.id === id)?.name ?? '?';
  const current = selected ? tables.find((t) => t.id === selected) : undefined;

  const onTap = (t: FloorTable) => {
    if (editing) {
      setForm(t);
      return;
    }
    if (picking) {
      if (t.id === picking.headId) return;
      if (!isStandalone(t)) {
        setMessage('Unmerge first.');
        return;
      }
      setPicking({ ...picking, memberIds: toggle(picking.memberIds, t.id) });
      return;
    }
    setSelected((id) => (id === t.id ? null : t.id));
  };

  const onPointerDown = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = positionOf(t);
    dragRef.current = {
      id: t.id,
      offset: { x: event.clientX / scale - pos.x, y: event.clientY / scale - pos.y },
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  };

  const onPointerMove = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.id !== t.id) return;
    // Activation distance so a click that drifts a pixel still registers as a tap, matching the
    // tablet's Gesture.Pan() activation distance.
    if (Math.abs(event.clientX - drag.start.x) > 3 || Math.abs(event.clientY - drag.start.y) > 3) {
      drag.moved = true;
    }
    const next = clampPosition(t, event.clientX / scale - drag.offset.x, event.clientY / scale - drag.offset.y);
    setOverride((current) => ({ ...current, [t.id]: next }));
  };

  const onPointerUp = (t: FloorTable) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.id !== t.id) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (drag.moved) {
        const { x, y } = positionOf(t);
        updateLayout.mutate({ items: [{ id: t.id, x, y, w: t.w, h: t.h }] });
        return;
      }
      // Clean up the sub-threshold override so the table snaps back to its stored position
      // and the next drag starts from a clean baseline.
      release(t.id);
    }
    onTap(t);
  };

  const onPointerCancel = (t: FloorTable) => () => {
    if (dragRef.current?.id !== t.id) return;
    dragRef.current = null;
    release(t.id);
  };

  return (
    <section>
      <h2>Floor</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {can('table.layout_manage') && (
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setSelected(null);
              setPicking(null);
            }}
          >
            {editing ? 'Done' : 'Edit layout'}
          </button>
        )}
        {editing && can('table.create') && (
          <button type="button" onClick={() => setForm('new')}>
            Add table
          </button>
        )}
      </div>
      {message && (
        <p role="alert" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}
      {list.error && <p role="alert">{list.error.message}</p>}
      {reservationsQuery.error && <p role="alert">{reservationsQuery.error.message}</p>}

      {picking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span>
            Merging into {nameOf(picking.headId)} — click tables to add ({picking.memberIds.length})
          </span>
          <button
            type="button"
            disabled={picking.memberIds.length === 0 || merge.isPending}
            onClick={() => merge.mutate(picking)}
          >
            Confirm
          </button>
          <button type="button" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}

      {current && !editing && !picking && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <strong>{current.name}</strong>
          {can('table.merge') && !current.mergedIntoId && (
            <button type="button" onClick={() => setPicking({ headId: current.id, memberIds: [] })}>
              Merge
            </button>
          )}
          {can('table.merge') && !isStandalone(current) && (
            <button type="button" disabled={unmerge.isPending} onClick={() => unmerge.mutate({ id: current.id })}>
              Unmerge
            </button>
          )}
          {can('reservation.create') && (
            <button type="button" onClick={() => setReserving(current)}>
              Reserve
            </button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          aspectRatio: '1 / 1',
          background: '#fafafa',
          border: '1px solid #ddd',
          overflow: 'hidden',
        }}
      >
        {tables.map((t) => {
          const pos = positionOf(t);
          const headId = t.mergedIntoId ?? (groups.has(t.id) ? t.id : null);
          const picked = picking?.memberIds.includes(t.id) || picking?.headId === t.id;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onPointerDown={onPointerDown(t)}
              onPointerMove={onPointerMove(t)}
              onPointerUp={onPointerUp(t)}
              onPointerCancel={onPointerCancel(t)}
              style={{
                position: 'absolute',
                left: pos.x * scale,
                top: pos.y * scale,
                width: t.w * scale,
                height: t.h * scale,
                borderRadius: 8,
                border: `2px ${picked ? 'dashed' : 'solid'} ${groupColor(headId)}`,
                boxShadow: selected === t.id ? '0 0 0 3px #3b82f6' : undefined,
                background: '#eee',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
                userSelect: 'none',
                cursor: editing ? 'grab' : 'pointer',
              }}
            >
              <strong>{t.name}</strong>
              <small>{seatsOf(t.id, tables)} seats</small>
              {isReserved(t.id, reservations, now) && <small style={{ color: '#b45309' }}>Reserved</small>}
            </div>
          );
        })}
      </div>

      {can('reservation.view') && (
        <ReservationList reservations={reservations} tables={tables} canUpdate={can('reservation.update')} />
      )}

      {form && (
        <TableForm
          table={form === 'new' ? null : form}
          canDelete={can('table.delete')}
          onClose={() => setForm(null)}
        />
      )}
      {reserving && <ReservationForm table={reserving} onClose={() => setReserving(null)} />}
    </section>
  );
}
