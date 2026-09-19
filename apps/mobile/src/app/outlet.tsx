import { useMutation } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { refreshClient } from '@/lib/trpc';

/** Picking an outlet is `auth.refresh` with an `outletId`; the server reissues the session for it. */
export default function OutletScreen() {
  const router = useRouter();
  const { accessToken, hydrated, refreshToken, outlets, outlet, setSession } = useAuthStore();

  const pick = useMutation({
    mutationFn: (outletId: string) =>
      refreshClient.auth.refresh.mutate({ refreshToken: refreshToken!, outletId }),
    // `index.tsx` redirected here with `replace`, so there is no back stack to pop; go home explicitly.
    onSuccess: (session) => {
      setSession(session);
      router.replace('/');
    },
  });

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (!accessToken) return <Redirect href="/profiles" />;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <ScrollView contentContainerClassName="flex-grow justify-center p-6">
        <View className="w-full max-w-md self-center gap-6 rounded-3xl bg-surface p-6">
          <Text className="font-poppins-bold text-2xl text-ink-primary">Pilih outlet</Text>

          {outlets.length === 0 && (
            <Alert variant="warning">Belum ada outlet untuk akun ini. Minta pemilik menambahkanmu.</Alert>
          )}

          <View className="gap-3">
            {outlets.map((o) => (
              <Button
                key={o.id}
                testID={`outlet-${o.id}`}
                size="lg"
                variant={o.id === outlet?.id ? 'default' : 'outline'}
                disabled={pick.isPending}
                onPress={() => pick.mutate(o.id)}
              >
                {o.name}
              </Button>
            ))}
          </View>

          {pick.error && <Alert variant="danger">{pick.error.message}</Alert>}

          <Button variant="ghost" onPress={park}>
            Keluar
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
