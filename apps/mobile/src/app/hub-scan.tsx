import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseHubQr } from '@repo/api-contract';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { connectToHub } from '@/lib/hub';

/** Scans the QR on the desktop's Hub page (US-003). */
export default function HubScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The camera reports the same code many times a second; one connect attempt at a time.
  const busy = useRef(false);
  // The last rejected code stays in view after a failure; ignore that exact text until another one is scanned.
  const rejected = useRef<string | null>(null);

  const onScan = ({ data }: BarcodeScanningResult) => {
    if (busy.current || data === rejected.current) return;
    const qr = parseHubQr(data);
    if (!qr) {
      rejected.current = data;
      return setError('Ini bukan kode QR hub. Pindai kode di halaman Perangkat di komputer kasir.');
    }
    busy.current = true;
    setPending(true);
    setError(null);
    connectToHub(qr, qr.outletId).then(
      () => router.replace('/'),
      (e: Error) => {
        rejected.current = data;
        setError(e.message);
        setPending(false);
        busy.current = false;
      },
    );
  };

  if (!permission) return <ActivityIndicator className="flex-1" />;

  if (!permission.granted)
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-surface-canvas p-6">
        <Text className="text-center font-poppins text-base text-ink-primary">
          {permission.canAskAgain
            ? 'Izinkan kamera untuk memindai kode QR di halaman Perangkat di komputer kasir.'
            : 'Kamera diblokir. Buka Pengaturan, izinkan kamera untuk aplikasi ini, lalu kembali ke sini.'}
        </Text>
        <Button
          size="lg"
          onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
        >
          Izinkan kamera
        </Button>
        <Button variant="ghost" size="lg" onPress={() => router.back()}>
          Kembali
        </Button>
      </SafeAreaView>
    );

  return (
    <SafeAreaView className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={pending ? undefined : onScan}
      />
      <View className="gap-3 p-4">
        {error && <Alert variant="danger">{error}</Alert>}
        {error && !pending && (
          <Button
            size="lg"
            onPress={() => {
              rejected.current = null;
              setError(null);
            }}
          >
            Coba lagi
          </Button>
        )}
        <Button variant="soft" size="lg" disabled={pending} onPress={() => router.back()}>
          {pending ? 'Menghubungkan…' : 'Batal'}
        </Button>
      </View>
    </SafeAreaView>
  );
}
