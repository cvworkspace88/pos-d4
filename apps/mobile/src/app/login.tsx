import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { PasswordField, TextField } from '@ui/text-field';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

const schema = z.object({
  username: z.string().min(3, 'Minimal 3 karakter.'),
  password: z.string().min(8, 'Minimal 8 karakter.'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const login = useMutation(trpc.auth.login.mutationOptions({ onSuccess: setSession }));

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <ScrollView contentContainerClassName="flex-grow justify-center p-6">
        {/* Capped so the card stays a card on a tablet instead of stretching edge to edge. */}
        <View className="w-full max-w-md self-center gap-6 rounded-3xl bg-surface p-6">
          <View className="items-center gap-2">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary">
              <Text className="font-poppins-bold text-3xl text-white">P</Text>
            </View>
            <Text className="font-poppins-bold text-2xl text-ink-primary">Point of Sale</Text>
            <Text className="font-poppins text-sm text-ink-tertiary">Kafe Melati Group</Text>
          </View>

          <View className="gap-4">
            <Controller
              control={control}
              name="username"
              render={({ field }) => (
                <TextField
                  testID="login-username"
                  label="Username"
                  placeholder="andi.k"
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={formState.errors.username?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <PasswordField
                  testID="login-password"
                  label="Kata sandi"
                  placeholder="••••••••"
                  error={formState.errors.password?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </View>

          {login.error && (
            <Alert testID="login-error" variant="danger">
              {login.error.message}
            </Alert>
          )}

          <Button
            testID="login-submit"
            size="lg"
            disabled={login.isPending}
            // Rejections render in the alert above; an unhandled one would crash the app.
            onPress={handleSubmit((values) => login.mutateAsync(values).catch(() => undefined))}
          >
            {login.isPending ? 'Memproses…' : 'Masuk'}
          </Button>

          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border-subtle" />
            <Text className="font-poppins text-sm text-ink-tertiary">atau</Text>
            <View className="h-px flex-1 bg-border-subtle" />
          </View>

          <Button testID="login-pin" variant="soft" size="lg" onPress={() => router.replace('/profiles')}>
            Masuk dengan PIN terminal
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
