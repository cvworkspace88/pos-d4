import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

export default function HomeScreen() {
  const trpc = useTRPC();
  const { user, accessToken, hydrated } = useAuthStore();
  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: Boolean(accessToken) });

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (!accessToken) return <Redirect href="/profiles" />;
  // A profile without a PIN cannot be re-entered; make them set one before doing anything else.
  if (user && !user.hasPin) return <Redirect href="/set-pin" />;

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>POS D4</Text>
      <Text>{me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}</Text>
      <View style={styles.spacer} />
      {/* Keeps the profile on this tablet; remove it from the picker instead. */}
      <Button title="Sign out" onPress={park} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
  spacer: { height: 16 },
});
