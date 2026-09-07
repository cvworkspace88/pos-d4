import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

const schema = z.object({
  username: z.string().min(3, 'At least 3 characters.'),
  password: z.string().min(8, 'At least 8 characters.'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { accessToken, hydrated, setSession } = useAuthStore();

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: setSession,
    }),
  );

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (accessToken) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Sign in</Text>

      <Controller
        control={control}
        name="username"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      {formState.errors.username && <Text style={styles.error}>{formState.errors.username.message}</Text>}

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      {formState.errors.password && <Text style={styles.error}>{formState.errors.password.message}</Text>}

      <View style={styles.spacer} />
      <Button
        title={login.isPending ? 'Signing in…' : 'Sign in'}
        disabled={login.isPending}
        onPress={handleSubmit((values) => login.mutateAsync(values).catch(() => undefined))}
      />
      {login.error && <Text style={styles.error}>{login.error.message}</Text>}

      <View style={styles.spacer} />
      <Button title="Back" onPress={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  error: { color: '#c00' },
  spacer: { height: 8 },
});
