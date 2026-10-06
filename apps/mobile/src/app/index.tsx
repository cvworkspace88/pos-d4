import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, type AlertVariant } from '@ui/alert';
import { Button as UIButton, type ButtonSize, type ButtonVariant } from '@ui/button';
import { PasswordField, TextField } from '@ui/text-field';
import { park } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';
import { currentHub, useHubStore } from '@/lib/stores/hub';
import { useTRPC } from '@/lib/trpc';

const VARIANTS: ButtonVariant[] = ['default', 'ghost', 'outline', 'soft', 'danger'];
const SIZES: ButtonSize[] = ['lg', 'md', 'sm'];
const ALERT_VARIANTS: AlertVariant[] = ['primary', 'warning', 'danger', 'success'];

/** Every button variant at every size, plus the disabled state of each. */
function ButtonShowcase() {
  return (
    <View className="gap-3 py-4">
      {SIZES.map((size) => (
        <View key={size} className="flex-row flex-wrap items-center gap-3">
          {VARIANTS.map((variant) => (
            <UIButton key={variant} variant={variant} size={size}>
              {`${variant} / ${size}`}
            </UIButton>
          ))}
          {VARIANTS.map((variant) => (
            <UIButton key={`${variant}-disabled`} variant={variant} size={size} disabled>
              {`${variant} / ${size} off`}
            </UIButton>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Every alert variant. */
function AlertShowcase() {
  return (
    <View className="gap-3 pb-4">
      {ALERT_VARIANTS.map((variant) => (
        <Alert key={variant} variant={variant}>
          Kalimat penjelas.
        </Alert>
      ))}
    </View>
  );
}

/** Default, filled, disabled, plus the error and helper messages and the password toggle. */
function TextFieldShowcase() {
  return (
    <View className="gap-3 pb-4">
      <TextField label="Label" placeholder="Nilai" />
      <TextField label="Label" defaultValue="Nilai" helperText="Kalimat penjelas." />
      <TextField label="Label" placeholder="Nilai" disabled />
      <TextField label="Label" defaultValue="Nilai" error="Kalimat kesalahan." />
      <PasswordField label="Kata sandi" placeholder="••••••••" />
    </View>
  );
}

export default function HomeScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { user, accessToken, hydrated, outlet, switching, startSwitch } = useAuthStore();
  const hubHydrated = useHubStore((s) => s.hydrated);
  const hub = useHubStore(currentHub);
  const me = useQuery({
    ...trpc.auth.me.queryOptions(),
    enabled: Boolean(accessToken) && hubHydrated && hub !== null,
  });

  if (!hydrated || !hubHydrated) return <ActivityIndicator style={styles.center} />;
  // Nothing works without a hub to talk to (US-003): pair one before anyone signs in.
  if (!hub) return <Redirect href="/hub" />;
  if (!accessToken) return <Redirect href="/profiles" />;
  // A profile without a PIN cannot be re-entered; make them set one before doing anything else.
  if (user && !user.hasPin) return <Redirect href="/set-pin" />;
  // No outlet means no role, so nothing below would be allowed anyway. Pick first — an empty
  // list still routes here, where the picker shows its own "no outlets" empty state.
  if (!outlet || switching) return <Redirect href="/outlet" />;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>POS D4</Text>
        <Text>{me.isPending ? 'Loading…' : (me.data?.name ?? me.error?.message)}</Text>
        {outlet && (
          <>
            <Text>{outlet.name}</Text>
            <Button title="Ganti outlet" onPress={startSwitch} />
          </>
        )}
        <ButtonShowcase />
        <AlertShowcase />
        <TextFieldShowcase />
        {me.data?.permissions.includes('table.view') && (
          <Button title="Floor" onPress={() => router.push('/floor')} />
        )}
        <View style={styles.spacer} />
        <Button title="Ubah PIN" onPress={() => router.push('/set-pin?mode=change')} />
        <Button title="Ubah password" onPress={() => router.push('/change-password')} />
        {/* Keeps the profile on this tablet; remove it from the picker instead. */}
        <Button title="Sign out" onPress={park} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 24, gap: 8, justifyContent: 'center', flexGrow: 1 },
  title: { fontSize: 28, fontWeight: '600' },
  spacer: { height: 16 },
});
