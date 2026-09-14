import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Alert as RNAlert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@ui/avatar';
import { Button } from '@ui/button';
import { Card } from '@ui/card';
import { removeProfile } from '@/lib/session';
import { useAuthStore } from '@/lib/stores/auth';

export default function ProfilesScreen() {
  const router = useRouter();
  const { accessToken, hydrated, profiles } = useAuthStore();

  if (!hydrated) return <ActivityIndicator className="flex-1" />;
  if (accessToken) return <Redirect href="/" />;

  const list = Object.values(profiles);

  const confirmRemove = (userId: string, name: string) =>
    RNAlert.alert(`Hapus ${name}?`, 'Mereka perlu kata sandi untuk masuk lagi di tablet ini.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: () => removeProfile(userId),
      },
    ]);

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-8 p-6">
        <View className="items-center gap-1">
          <Text className="font-poppins-bold text-2xl text-ink-primary">Siapa yang bertugas?</Text>
          <Text className="font-poppins text-sm text-ink-tertiary">Ketuk namamu, lalu masukkan PIN</Text>
        </View>

        {list.length === 0 && (
          <Text className="text-center font-poppins text-sm text-ink-tertiary">
            Belum ada yang masuk di tablet ini.
          </Text>
        )}

        <View className="flex-row flex-wrap justify-center gap-4">
          {list.map(({ user }) => (
            <Pressable
              key={user.id}
              testID={`profile-${user.username}`}
              // Feedback lives on the wrapper, not the Card: an `active:` class on the Card would
              // never fire — only the Pressable knows it is being pressed.
              className="active:scale-[0.98] active:opacity-90"
              onPress={() => router.push(`/pin/${user.id}`)}
              onLongPress={() => confirmRemove(user.id, user.name)}
            >
              <Card className="w-44">
                <Avatar name={user.name} seed={user.id} className="self-center" />
                <View className="items-center gap-0.5">
                  <Text className="font-poppins-semibold text-base text-ink-primary">{user.name}</Text>
                  {/* `name` has no unique constraint — two staff called "John Smith" would otherwise
                      get two identical cards. The username is what actually distinguishes them. */}
                  <Text className="font-poppins text-xs text-ink-tertiary">@{user.username}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>

        <View className="items-center gap-2">
          <Button testID="profiles-password" variant="soft" size="lg" onPress={() => router.push('/login')}>
            Masuk dengan username & sandi
          </Button>
          <Text className="font-poppins text-xs text-ink-muted">
            Tekan lama sebuah nama untuk menghapusnya dari tablet ini.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
