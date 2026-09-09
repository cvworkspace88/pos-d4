import '../../global.css';

import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { useFonts } from '@expo-google-fonts/poppins/useFonts';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useIdleTimer } from '@/hooks/use-idle-timer';
import { TRPCProvider, queryClient, trpcClient } from '@/lib/trpc';

SplashScreen.preventAutoHideAsync();

/** Inside the providers so the idle hook can query settings. */
function Shell() {
  const bump = useIdleTimer();
  return (
    // Capture-phase responder sees every touch on every screen without stealing any of them —
    // including touches gesture-handler goes on to claim for a drag.
    <GestureHandlerRootView
      style={styles.root}
      onStartShouldSetResponderCapture={() => {
        bump();
        return false;
      }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

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
