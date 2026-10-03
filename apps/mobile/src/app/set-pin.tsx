import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { isLocked, needsPassword } from '@repo/api-contract';
import { PasswordField } from '@ui/text-field';
import { LockedDialog } from '@/components/locked-dialog';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

// Same rule as the API's `pinInput`; duplicated because mobile cannot import from apps/api.
const base = z.object({
  pin: z.string().regex(/^\d{6}$/, 'Harus 6 digit.'),
  confirm: z.string(),
  password: z.string(),
});
const samePin = (schema: typeof base) =>
  schema.refine((values) => values.pin === values.confirm, { message: 'PIN tidak sama.', path: ['confirm'] });
const pinOnly = zodResolver(samePin(base));
// Changing an existing PIN (US-006) needs the password, and so does a first one once the password
// login is no longer fresh; the server enforces both.
const withPassword = zodResolver(
  samePin(base.extend({ password: z.string().min(8, 'Minimal 8 karakter.') })),
);

type FormValues = z.infer<typeof base>;

export default function SetPinScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { user, accessToken, hydrated, setUser } = useAuthStore();
  // From the route, not `hasPin`: the store may not be hydrated on the first render, and a first-time
  // setup flips `hasPin` on success and must then leave via the redirect below.
  const changing = useLocalSearchParams<{ mode?: string }>().mode === 'change';
  // A restored or deep-linked screen has no history to go back to.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // A first PIN asks for the password only when the server says so (`NEEDS_PASSWORD`): the login is
  // no longer fresh, or a PIN was made elsewhere meanwhile.
  const [askPassword, setAskPassword] = useState(changing);

  // react-hook-form re-reads its options each render: the resolver follows `askPassword` and the
  // typed digits survive the switch.
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: askPassword ? withPassword : pinOnly,
    defaultValues: { pin: '', confirm: '', password: '' },
  });

  const setPin = useMutation(
    trpc.auth.setPin.mutationOptions({
      onSuccess: (updated) => {
        setUser(updated);
        if (changing) leave();
      },
      onError: (error) => {
        if (needsPassword(error)) setAskPassword(true);
      },
    }),
  );
  const locked = isLocked(setPin.error);

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;
  if (user?.hasPin && !changing) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{changing ? 'Ubah PIN' : 'Buat PIN'}</Text>
      <Text style={styles.hint}>PIN dipakai untuk masuk di tablet ini, menggantikan password.</Text>

      {askPassword && (
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <PasswordField
              label="Password"
              error={formState.errors.password?.message}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      )}

      {(['pin', 'confirm'] as const).map((name) => (
        <View key={name}>
          <Controller
            control={control}
            name={name}
            render={({ field }) => (
              <TextInput
                style={styles.input}
                placeholder={name === 'pin' ? 'PIN baru (6 digit)' : 'Ulangi PIN'}
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
        title={setPin.isPending ? 'Menyimpan…' : 'Simpan PIN'}
        disabled={setPin.isPending}
        onPress={handleSubmit(({ pin, password }) =>
          setPin.mutateAsync({ pin, password: askPassword ? password : undefined }).catch(() => undefined),
        )}
      />
      {changing && <Button title="Batal" onPress={leave} />}
      {setPin.error && !locked && <Text style={styles.error}>{setPin.error.message}</Text>}
      <LockedDialog visible={locked} onClose={() => setPin.reset()} />
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
