import { zodResolver } from '@hookform/resolvers/zod';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { Card } from '@ui/card';
import { TextField } from '@ui/text-field';
import { useFoundHubs, type FoundHub } from '@/lib/discovery';
import { connectToHub } from '@/lib/hub';
import { currentHub, useHubStore } from '@/lib/stores/hub';

const schema = z.object({
  host: z
    .string()
    .trim()
    .min(1, 'Isi alamat IP komputer kasir.')
    .regex(/^[A-Za-z0-9.-]+$/, 'Isi alamat IP saja, tanpa port (contoh 192.168.1.20).'),
  port: z.string().regex(/^\d{1,5}$/, 'Port berupa angka, biasanya 3333.'),
});
type FormValues = z.infer<typeof schema>;

/** Pick a hub three ways (US-003): from the Wi-Fi, by QR, or by typing the address the desktop's Hub page shows. */
export default function HubScreen() {
  const router = useRouter();
  const hub = useHubStore(currentHub);
  const found = useFoundHubs();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // Dev convenience: Metro's host is usually the desktop running `pnpm api:dev`.
    defaultValues: {
      host: hub?.host ?? Constants.expoConfig?.hostUri?.split(':')[0] ?? '',
      port: String(hub?.port ?? 3333),
    },
  });

  const connect = async (target: { host: string; port: number }, expectedOutletId?: string) => {
    setPending(true);
    setError(null);
    try {
      await connectToHub(target, expectedOutletId);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      {/* "handled": with the keyboard open, the first tap on a button presses it, not just closes the
          keyboard. */}
      <ScrollView
        contentContainerClassName="flex-grow justify-center p-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-md self-center gap-6 rounded-3xl bg-surface p-6">
          <View className="gap-1">
            <Text className="font-poppins-bold text-2xl text-ink-primary">Hubungkan ke hub</Text>
            <Text className="font-poppins text-sm text-ink-tertiary">
              {hub
                ? `Terhubung ke ${hub.outletName} (${hub.host}:${hub.port}).`
                : 'Pilih komputer kasir di Wi-Fi outlet ini.'}
            </Text>
          </View>

          <View className="gap-3">
            <Text className="font-poppins-semibold text-sm text-ink-secondary">Ditemukan di Wi-Fi</Text>
            {found.hubs.map((h: FoundHub) => (
              <Pressable
                key={`${h.outletId}-${h.host}`}
                testID={`hub-${h.outletId}`}
                className="active:opacity-90"
                disabled={pending}
                onPress={() => void connect(h, h.outletId)}
              >
                <Card>
                  <Text className="font-poppins-semibold text-base text-ink-primary">{h.name}</Text>
                  <Text className="font-poppins text-xs text-ink-tertiary">
                    {h.host}:{h.port}
                  </Text>
                </Card>
              </Pressable>
            ))}
            {found.hubs.length === 0 && (
              <Text className="font-poppins text-sm text-ink-tertiary">
                {!found.supported
                  ? 'Pencarian otomatis tidak tersedia di sini. Pindai kode QR atau isi alamatnya.'
                  : (found.error ?? 'Mencari… Pastikan aplikasi kasir di komputer terbuka.')}
              </Text>
            )}
          </View>

          <Button variant="soft" size="lg" disabled={pending} onPress={() => router.push('/hub-scan')}>
            Pindai kode QR
          </Button>

          <View className="gap-4">
            <Controller
              control={control}
              name="host"
              render={({ field }) => (
                <TextField
                  testID="hub-host"
                  label="Alamat IP"
                  placeholder="192.168.1.20"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  error={formState.errors.host?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <Controller
              control={control}
              name="port"
              render={({ field }) => (
                <TextField
                  testID="hub-port"
                  label="Port"
                  keyboardType="number-pad"
                  error={formState.errors.port?.message}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </View>

          {error && (
            <Alert testID="hub-error" variant="danger">
              {error}
            </Alert>
          )}

          <Button
            testID="hub-connect"
            size="lg"
            disabled={pending}
            onPress={handleSubmit((v) => connect({ host: v.host, port: Number(v.port) }))}
          >
            {pending ? 'Menghubungkan…' : 'Hubungkan'}
          </Button>

          {hub && (
            <Button variant="ghost" size="lg" disabled={pending} onPress={() => router.replace('/')}>
              Kembali
            </Button>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
