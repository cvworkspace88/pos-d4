import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/lib/stores/auth';
import { trpcClient, useTRPC } from '@/lib/trpc';

/**
 * Local state goes first, so a slow or failed call can never trap the user in a signed-in shell.
 * The server call is fire-and-forget: without it the refresh token stays valid for its full 30 days.
 */
function signOut() {
  const { refreshToken, clear } = useAuthStore.getState();
  clear();
  if (refreshToken) void trpcClient.auth.logout.mutate({ refreshToken }).catch(() => undefined);
}

export default function HomeScreen() {
  const trpc = useTRPC();
  const { accessToken, hydrated } = useAuthStore();
  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: Boolean(accessToken) });

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>POS D4</Text>
      <Text>{me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}</Text>
      <View style={styles.spacer} />
      <Button title="Sign out" onPress={signOut} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
  spacer: { height: 16 },
});
