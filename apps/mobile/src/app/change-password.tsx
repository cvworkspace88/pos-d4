import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Alert as NativeAlert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { isLocked } from '@repo/api-contract';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { PasswordField } from '@ui/text-field';
import { LockedDialog } from '@/components/locked-dialog';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Wajib diisi.'),
    newPassword: z.string().min(8, 'Minimal 8 karakter.').max(128, 'Maksimal 128 karakter.'),
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    message: 'Password tidak sama.',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

const FIELDS = [
  ['currentPassword', 'Password saat ini'],
  ['newPassword', 'Password baru'],
  ['confirm', 'Ulangi password baru'],
] as const;

/** US-005: change your own password. Other sessions stay signed in. */
export default function ChangePasswordScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { accessToken, hydrated } = useAuthStore();
  // A restored or deep-linked screen has no history to go back to.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        leave();
        NativeAlert.alert('Password berhasil diubah.');
      },
    }),
  );
  const locked = isLocked(change.error);

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <ScrollView contentContainerClassName="flex-grow justify-center p-6">
        <View className="w-full max-w-md self-center gap-6 rounded-3xl bg-surface p-6">
          <Text className="font-poppins-bold text-2xl text-ink-primary">Ubah password</Text>

          <View className="gap-4">
            {FIELDS.map(([name, label]) => (
              <Controller
                key={name}
                control={control}
                name={name}
                render={({ field }) => (
                  <PasswordField
                    label={label}
                    error={formState.errors[name]?.message}
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            ))}
          </View>

          {change.error && !locked && <Alert variant="danger">{change.error.message}</Alert>}

          <Button
            size="lg"
            disabled={change.isPending}
            onPress={handleSubmit(({ currentPassword, newPassword }) =>
              change.mutateAsync({ currentPassword, newPassword }).catch(() => undefined),
            )}
          >
            {change.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
          <Button variant="ghost" onPress={leave}>
            Batal
          </Button>
        </View>
      </ScrollView>
      <LockedDialog visible={locked} onClose={() => change.reset()} />
    </SafeAreaView>
  );
}
