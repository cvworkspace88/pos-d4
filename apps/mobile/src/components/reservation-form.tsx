import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Button, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nextFullHourLocal } from '@repo/api-contract';
import { z } from 'zod';
import type { TableRow } from '@/components/floor-table';
import { useTRPC } from '@/lib/trpc';

// ponytail: date and time are text fields (YYYY-MM-DD, HH:mm). No native picker is installed;
// swap for @expo/ui DateTimePicker once the dev build is in place.
const schema = z
  .object({
    customerName: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
    phone: z.string().trim().max(32, 'At most 32 characters.'),
    partySize: z
      .string()
      .regex(/^\d+$/, 'Whole number.')
      .transform(Number)
      .pipe(z.number().min(1, 'At least 1.').max(100, 'At most 100.')),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm'),
    note: z.string().trim().max(500, 'At most 500 characters.'),
  })
  // No offset in the string, so JS parses it as device-local time — what the waiter means.
  .refine((values) => !Number.isNaN(new Date(`${values.date}T${values.time}`).getTime()), {
    message: 'Not a valid date and time.',
    path: ['time'],
  });

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

const FIELDS = [
  ['customerName', 'Customer', 'default'],
  ['phone', 'Phone', 'phone-pad'],
  ['partySize', 'Party size', 'number-pad'],
  ['date', 'Date (YYYY-MM-DD)', 'numbers-and-punctuation'],
  ['time', 'Time (HH:mm)', 'numbers-and-punctuation'],
  ['note', 'Note', 'default'],
] as const;

export function ReservationForm({ table, onClose }: { table: TableRow; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [date, time] = nextFullHourLocal().split('T') as [string, string];

  const { control, handleSubmit, formState } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { customerName: '', phone: '', partySize: '2', date, time, note: '' },
  });

  const create = useMutation(
    trpc.reservation.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.reservation.list.queryKey() });
        onClose();
      },
    }),
  );

  const submit = (values: FormOutput) =>
    create
      .mutateAsync({
        tableId: table.id,
        customerName: values.customerName,
        phone: values.phone || undefined,
        partySize: values.partySize,
        startsAt: new Date(`${values.date}T${values.time}`).toISOString(),
        note: values.note || undefined,
      })
      .catch(() => undefined);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Reserve {table.name}</Text>

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
                  autoCapitalize={name === 'customerName' ? 'words' : 'none'}
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
        <Button title={create.isPending ? 'Saving…' : 'Reserve'} disabled={create.isPending} onPress={handleSubmit(submit)} />
        <Button title="Cancel" onPress={onClose} />
        {create.error && <Text style={styles.error}>{create.error.message}</Text>}
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
