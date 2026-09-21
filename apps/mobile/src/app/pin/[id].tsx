import { useMutation } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '@ui/alert';
import { Avatar } from '@ui/avatar';
import { Keypad } from '@ui/keypad';
import { PinInput } from '@ui/pin-input';
import { removeProfile } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

const PIN_LENGTH = 6;

export default function PinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const router = useRouter();
  const { accessToken, hydrated, profiles, setSession } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const profile = profiles[id];

  const pinLogin = useMutation(
    trpc.auth.pinLogin.mutationOptions({
      onSuccess: setSession,
      onError: (mutationError) => {
        // Every PIN failure is UNAUTHORIZED, so the code alone cannot say whether the card is
        // still good. `reason: 'INVALID_PIN'` means the profile is fine and the digits were not —
        // keep it. Anything else means the profile is dead (expired, revoked, no PIN), so the card
        // goes and there is nothing left on this screen to retry against.
        // Cast: the generated contract is built without the formatter, so `reason` is not in the
        // inferred error type. Same reason `lib/trpc.ts` casts.
        const data = mutationError.data as { code?: string; reason?: string } | undefined;
        if (data?.code === 'UNAUTHORIZED' && data.reason !== 'INVALID_PIN') {
          removeProfile(id);
          router.replace('/profiles');
          return;
        }
        // The digits stay on screen, painted red, until the next keypress replaces them.
        setError(mutationError.message);
      },
    }),
  );

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (accessToken) return <Redirect href="/" />;
  // Deep link to a profile this tablet does not have, or one just evicted mid-attempt.
  if (!profile) return <Redirect href="/profiles" />;

  const press = (digit: string) => {
    if (pinLogin.isPending) return;
    // A rejected attempt is cleared by typing over it, so the red dots survive long enough to read.
    const base = error ? '' : pin;
    const next = (base + digit).slice(0, PIN_LENGTH);
    setError(null);
    setPin(next);
    if (next.length === PIN_LENGTH) {
      pinLogin.mutate({ refreshToken: profile.refreshToken, pin: next });
    }
  };

  const backspace = () => {
    setError(null);
    setPin((current) => (error ? '' : current.slice(0, -1)));
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <View className="flex-1 flex-col gap-6 p-6 md:flex-row md:items-center md:gap-10">
        <View className="items-center gap-3 md:flex-1">
          <Avatar name={profile.user.name} seed={profile.user.id} size="lg" />
          <View className="items-center gap-1">
            <Text className="font-poppins-bold text-2xl text-ink-primary">{profile.user.name}</Text>
            <Text className="font-poppins text-sm text-ink-tertiary">@{profile.user.username}</Text>
          </View>
          <Pressable testID="pin-not-you" onPress={() => router.replace('/profiles')}>
            <Text className="font-poppins-medium text-sm text-primary">Bukan kamu?</Text>
          </Pressable>
        </View>

        <View className="w-full max-w-sm gap-5 self-center md:flex-1">
          <Text className="text-center font-poppins-semibold text-lg text-ink-primary">
            {error ? 'PIN tidak cocok' : 'Masukkan PIN'}
          </Text>

          <PinInput length={PIN_LENGTH} value={pin} invalid={Boolean(error)} />

          {error && (
            <Alert testID="pin-error" variant="danger">
              {error}
            </Alert>
          )}

          <Keypad onPress={press} onBackspace={backspace} disabled={pinLogin.isPending} />

          <Text className="font-poppins text-xs text-ink-muted">Lupa PIN? Minta manajer mengatur ulang.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
