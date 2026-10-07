import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { isLocked, needsPassword } from '@repo/api-contract';
import { Alert } from '@ui/alert';
import { Avatar } from '@ui/avatar';
import { Button } from '@ui/button';
import { PasswordField, TextField } from '@ui/text-field';
import { LockedDialog } from '@/components/locked-dialog';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

// Same rule as the API's `pinInput`; duplicated because mobile cannot import from apps/api.
const base = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN harus 6 angka.'),
  confirm: z.string(),
  password: z.string(),
});
const samePin = (schema: typeof base) =>
  schema.refine((values) => values.pin === values.confirm, {
    message: 'PIN tidak sama. Ketik ulang PIN yang sama.',
    path: ['confirm'],
  });
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
  // no longer fresh, or a PIN was made elsewhere meanwhile. Changing one always does.
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

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (!accessToken) return <Redirect href="/profiles" />;
  if (user?.hasPin && !changing) return <Redirect href="/" />;

  const submit = handleSubmit(({ pin, password }) =>
    // Rejections render in the alert below; an unhandled one would crash the app.
    setPin.mutateAsync({ pin, password: askPassword ? password : undefined }).catch(() => undefined),
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      {/* Changing: back to where the user came from. A first PIN has no skip (US-006), so its way out signs
          the user out instead; a PIN-less user is forgotten on this tablet (`park`). */}
      <Pressable
        testID="set-pin-back"
        accessibilityRole="button"
        accessibilityLabel={changing ? 'Kembali' : 'Keluar'}
        className="z-10 h-12 flex-row items-center gap-1 self-start px-4 active:opacity-60"
        disabled={setPin.isPending}
        onPress={changing ? leave : park}
      >
        <ChevronLeft size={24} color="#333333" />
        <Text className="font-poppins-medium text-base text-ink-primary">
          {changing ? 'Kembali' : 'Keluar'}
        </Text>
      </Pressable>

      <ScrollView
        contentContainerClassName="flex-grow justify-center p-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-md gap-6 self-center rounded-3xl bg-surface p-6">
          <View className="items-center gap-3">
            {user && <Avatar name={user.name} seed={user.id} size="lg" />}
            <View className="items-center gap-1">
              <Text className="font-poppins-bold text-2xl text-ink-primary">
                {changing ? 'Ubah PIN' : `Halo, ${user?.name ?? ''}`}
              </Text>
              <Text className="text-center font-poppins text-sm text-ink-tertiary">
                {changing
                  ? 'Masukkan password, lalu PIN baru dua kali.'
                  : 'Buat PIN 6 angka untuk masuk cepat di tablet ini, tanpa password.'}
              </Text>
            </View>
          </View>

          <View className="gap-4">
            {askPassword && (
              <Controller
                control={control}
                name="password"
                render={({ field }) => (
                  <PasswordField
                    testID="set-pin-password"
                    label="Password"
                    placeholder="••••••••"
                    error={formState.errors.password?.message}
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            )}
            <Controller
              control={control}
              name="pin"
              render={({ field }) => (
                <TextField
                  testID="set-pin-pin"
                  label="PIN baru"
                  placeholder="6 angka"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  error={formState.errors.pin?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <Controller
              control={control}
              name="confirm"
              render={({ field }) => (
                <TextField
                  testID="set-pin-confirm"
                  label="Ulangi PIN"
                  placeholder="6 angka"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  error={formState.errors.confirm?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  onSubmitEditing={() => void submit()}
                />
              )}
            />
          </View>

          {setPin.error && !locked && !needsPassword(setPin.error) && (
            <Alert testID="set-pin-error" variant="danger">
              {setPin.error.message}
            </Alert>
          )}
          {/* The password field just appeared: say why, so the user knows to fill it and tap again. */}
          {setPin.error && needsPassword(setPin.error) && (
            <Alert testID="set-pin-needs-password" variant="warning">
              {setPin.error.message}
            </Alert>
          )}

          <Button testID="set-pin-save" size="lg" disabled={setPin.isPending} onPress={() => void submit()}>
            {setPin.isPending ? 'Menyimpan…' : 'Simpan PIN'}
          </Button>
        </View>
      </ScrollView>
      <LockedDialog visible={locked} onClose={() => setPin.reset()} />
    </SafeAreaView>
  );
}
