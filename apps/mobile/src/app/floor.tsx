import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clampPosition, dayRange, groupsOf, isReserved, scaleFor, seatsOf } from '@repo/api-contract';
import { FloorTable, groupColor, type TableRow } from '@/components/floor-table';
import { ReservationForm } from '@/components/reservation-form';
import { TableForm } from '@/components/table-form';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

type Position = { x: number; y: number };

const ACTIONS = [
  ['seated', 'Seat'],
  ['no_show', 'No-show'],
  ['cancelled', 'Cancel'],
] as const;

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** Re-renders once a minute so the "Reserved" badge appears on time without a refetch. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function FloorScreen() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { accessToken, hydrated } = useAuthStore();
  const signedIn = Boolean(accessToken);

  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: signedIn });
  const permissions = me.data?.permissions ?? [];
  const can = (permission: string) => permissions.includes(permission);

  const listKey = trpc.table.list.queryKey();
  const list = useQuery({
    ...trpc.table.list.queryOptions(),
    enabled: signedIn && can('table.view'),
    refetchInterval: 30_000,
  });
  const tables = list.data ?? [];
  const groups = groupsOf(tables);

  const now = useNow();
  const reservationsQuery = useQuery({
    ...trpc.reservation.list.queryOptions(dayRange(now)),
    enabled: signedIn && can('reservation.view'),
    refetchInterval: 30_000,
  });
  const reservations = reservationsQuery.data ?? [];

  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = scaleFor(size.width, size.height);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TableRow | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ headId: string; memberIds: string[] } | null>(null);
  const [reserving, setReserving] = useState<TableRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Positions of tables just dropped and awaiting the server's answer, so a 30 s refetch landing
  // in between cannot snap a table back.
  const [override, setOverride] = useState<Record<string, Position>>({});

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
  const updateReservation = useMutation(
    trpc.reservation.update.mutationOptions({
      // Settled, not success: a PRECONDITION_FAILED means someone else already resolved it.
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() }),
    }),
  );

  const positionOf = (t: TableRow): Position => override[t.id] ?? { x: t.x, y: t.y };
  const isStandalone = (t: TableRow) => !t.mergedIntoId && !groups.has(t.id);
  const nameOf = (id: string) => tables.find((t) => t.id === id)?.name ?? '?';
  const current = selected ? tables.find((t) => t.id === selected) : undefined;
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const onTap = (t: TableRow) => {
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

  const onDrop = (t: TableRow, x: number, y: number) => {
    const next = clampPosition(t, x, y);
    setOverride((current) => ({ ...current, [t.id]: next }));
    updateLayout.mutate({ items: [{ id: t.id, ...next, w: t.w, h: t.h }] });
  };

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.bar}>
        <Button title="Back" onPress={() => router.back()} />
        <Text style={styles.title}>Floor</Text>
        {can('table.layout_manage') && (
          <Button
            title={editing ? 'Done' : 'Edit layout'}
            onPress={() => {
              setEditing((value) => !value);
              setSelected(null);
              setPicking(null);
            }}
          />
        )}
        {editing && can('table.create') && <Button title="Add table" onPress={() => setForm('new')} />}
      </View>
      {message && (
        <Pressable onPress={() => setMessage(null)}>
          <Text style={styles.error}>{message}</Text>
        </Pressable>
      )}
      {list.error && <Text style={styles.error}>{list.error.message}</Text>}
      {reservationsQuery.error && <Text style={styles.error}>{reservationsQuery.error.message}</Text>}

      {picking && (
        <View style={styles.bar}>
          <Text style={styles.grow}>
            Merging into {nameOf(picking.headId)} — tap tables to add ({picking.memberIds.length})
          </Text>
          <Button
            title="Confirm"
            disabled={picking.memberIds.length === 0 || merge.isPending}
            onPress={() => merge.mutate(picking)}
          />
          <Button title="Cancel" onPress={() => setPicking(null)} />
        </View>
      )}

      {current && !editing && !picking && (
        <View style={styles.bar}>
          <Text style={styles.name}>{current.name}</Text>
          {can('table.merge') && !current.mergedIntoId && (
            <Button title="Merge" onPress={() => setPicking({ headId: current.id, memberIds: [] })} />
          )}
          {can('table.merge') && !isStandalone(current) && (
            <Button title="Unmerge" disabled={unmerge.isPending} onPress={() => unmerge.mutate({ id: current.id })} />
          )}
          {can('reservation.create') && <Button title="Reserve" onPress={() => setReserving(current)} />}
        </View>
      )}

      <View
        style={styles.canvas}
        onLayout={(event) =>
          setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
        }
      >
        {scale > 0 &&
          tables.map((t) => (
            <FloorTable
              key={t.id}
              table={t}
              position={positionOf(t)}
              scale={scale}
              editing={editing}
              seats={seatsOf(t.id, tables)}
              color={groupColor(t.mergedIntoId ?? (groups.has(t.id) ? t.id : null))}
              reserved={isReserved(t.id, reservations, now)}
              selected={selected === t.id}
              picked={Boolean(picking && (picking.headId === t.id || picking.memberIds.includes(t.id)))}
              onTap={onTap}
              onDrop={onDrop}
            />
          ))}
      </View>

      {can('reservation.view') && (
        <ScrollView style={styles.list}>
          <Text style={styles.name}>Today&apos;s reservations</Text>
          {reservations.length === 0 && <Text style={styles.hint}>None.</Text>}
          {reservations.map((r) => (
            <View key={r.id} style={styles.bar}>
              <Text style={styles.grow}>
                {timeOf(r.startsAt)} · {nameOf(r.tableId)} · {r.customerName} × {r.partySize} · {r.status}
              </Text>
              {r.status === 'booked' &&
                can('reservation.update') &&
                ACTIONS.map(([status, label]) => (
                  <Button
                    key={status}
                    title={label}
                    disabled={updateReservation.isPending}
                    onPress={() => updateReservation.mutate({ id: r.id, status })}
                  />
                ))}
            </View>
          ))}
          {updateReservation.error && <Text style={styles.error}>{updateReservation.error.message}</Text>}
        </ScrollView>
      )}

      {form && (
        <TableForm table={form === 'new' ? null : form} canDelete={can('table.delete')} onClose={() => setForm(null)} />
      )}
      {reserving && <ReservationForm table={reserving} onClose={() => setReserving(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: '600', flex: 1 },
  name: { fontWeight: '600' },
  grow: { flex: 1 },
  hint: { color: '#666' },
  // Square canvas that fits the shorter side of the screen.
  canvas: {
    flex: 1,
    aspectRatio: 1,
    alignSelf: 'center',
    maxWidth: '100%',
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  list: { maxHeight: 200 },
  error: { color: '#c00' },
});
