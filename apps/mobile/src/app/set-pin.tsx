import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

// Same rule as the API's `pinInput`; duplicated because mobile cannot import from apps/api.
const schema = z
  .object({
    pin: z.string().regex(/^\d{6}$/, 'exactly 6 digits.'),
    confirm: z.string(),
  })
  .refine((values) => values.pin === values.confirm, { message: 'PINs do not match.', path: ['confirm'] });

type FormValues = z.infer<typeof schema>;

export default function SetPinScreen() {
  const trpc = useTRPC();
  const { user, accessToken, hydrated, setUser } = useAuthStore();

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pin: '', confirm: '' },
  });

  const setPin = useMutation(trpc.auth.setPin.mutationOptions({ onSuccess: setUser }));

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;
  if (user?.hasPin) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Choose a PIN</Text>
      <Text style={styles.hint}>You will use it instead of your password on this tablet.</Text>

      {(['pin', 'confirm'] as const).map((name) => (
        <View key={name}>
          <Controller
            control={control}
            name={name}
            render={({ field }) => (
              <TextInput
                style={styles.input}
                placeholder={name === 'pin' ? 'PIN (6-digits)' : 'Repeat PIN'}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
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
      <Button
        title={setPin.isPending ? 'Saving…' : 'Save PIN'}
        disabled={setPin.isPending}
        onPress={handleSubmit(({ pin }) => setPin.mutateAsync({ pin }).catch(() => undefined))}
      />
      {setPin.error && <Text style={styles.error}>{setPin.error.message}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
  hint: { color: '#666', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 20,
    letterSpacing: 6,
  },
  error: { color: '#c00' },
  spacer: { height: 8 },
});
