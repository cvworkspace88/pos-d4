import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Button, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import type { TableRow } from '@/components/floor-table';
import { useTRPC } from '@/lib/trpc';

// TextInput yields strings; parse to numbers here. Bounds mirror the API's zod schema, duplicated
// because mobile cannot import from apps/api.
const whole = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Whole number.')
    .transform(Number)
    .pipe(z.number().min(min, `At least ${min}.`).max(max, `At most ${max}.`));

const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(20, 'At most 20 characters.'),
  seats: whole(1, 50),
  w: whole(40, 500),
  h: whole(40, 500),
});

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

const FIELDS = [
  ['name', 'Name', 'default'],
  ['seats', 'Seats', 'number-pad'],
  ['w', 'Width', 'number-pad'],
  ['h', 'Height', 'number-pad'],
] as const;

/** Create (table null) or edit + delete. A new table lands at 50,50; the manager drags it from there. */
export function TableForm({
  table,
  canDelete,
  onClose,
}: {
  table: TableRow | null;
  canDelete: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.table.list.queryKey() });
    onClose();
  };

  const { control, handleSubmit, formState } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: table
      ? { name: table.name, seats: String(table.seats), w: String(table.w), h: String(table.h) }
      : { name: '', seats: '4', w: '100', h: '100' },
  });

  const create = useMutation(trpc.table.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.table.update.mutationOptions());
  const updateLayout = useMutation(trpc.table.updateLayout.mutationOptions());
  const remove = useMutation(trpc.table.delete.mutationOptions({ onSuccess: done }));

  const error = create.error ?? update.error ?? updateLayout.error ?? remove.error;
  const pending = create.isPending || update.isPending || updateLayout.isPending || remove.isPending;

  const submit = async ({ name, seats, w, h }: FormOutput) => {
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

  const confirmDelete = () =>
    table &&
    Alert.alert(`Delete ${table.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate({ id: table.id }) },
    ]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>{table ? `Edit ${table.name}` : 'New table'}</Text>

        {FIELDS.map(([name, label, keyboardType]) => (
          <View key={name}>
            <Text style={styles.label}>{label}</Text>
            <Controller
              control={control}
              name={name}
              render={({ field }) => (
                <TextInput
                  style={styles.input}
                  keyboardType={keyboardType}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {formState.errors[name] && <Text style={styles.error}>{formState.errors[name]?.message}</Text>}
          </View>
        ))}

        <View style={styles.spacer} />
        <Button title={pending ? 'Saving…' : 'Save'} disabled={pending} onPress={handleSubmit(submit)} />
        <Button title="Cancel" onPress={onClose} />
        {table && canDelete && <Button title="Delete" color="#c00" disabled={pending} onPress={confirmDelete} />}
        {error && <Text style={styles.error}>{error.message}</Text>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  label: { color: '#444' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: '#c00' },
  spacer: { height: 8 },
});
