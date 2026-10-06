import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHubLink } from '@/hooks/use-hub-link';

/** Over every screen, never in the way of a tap (US-003). Grey after one missed ping, red after two. */
export function HubBanner() {
  const link = useHubLink();
  const insets = useSafeAreaInsets();
  if (link === 'online') return null;
  const offline = link === 'offline';
  return (
    <View
      pointerEvents="none"
      testID={`hub-banner-${link}`}
      className={`absolute inset-x-0 top-0 px-4 pb-2 ${offline ? 'bg-danger' : 'bg-ink-tertiary'}`}
      style={{ paddingTop: insets.top + 8 }}
    >
      <Text className="text-center font-poppins-semibold text-sm text-white">
        {offline ? 'Hub offline — periksa Wi-Fi dan komputer kasir.' : 'Menyambung ulang ke hub…'}
      </Text>
    </View>
  );
}
