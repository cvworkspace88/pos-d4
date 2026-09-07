import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useIdleTimer } from '@/hooks/use-idle-timer';
import { TRPCProvider, queryClient, trpcClient } from '@/lib/trpc';

/** Inside the providers so the idle hook can query settings. */
function Shell() {
  const bump = useIdleTimer();
  return (
    // Capture-phase responder sees every touch on every screen without stealing any of them.
    <View
      style={styles.root}
      onStartShouldSetResponderCapture={() => {
        bump();
        return false;
      }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Shell />
        <StatusBar style="auto" />
      </TRPCProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
