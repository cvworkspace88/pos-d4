import { useMutation } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { removeProfile } from '@/lib/session';
import { useAuthStore, type Profile } from '@/lib/stores/auth';
import { useTRPC } from '@/lib/trpc';

export default function ProfilesScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const { accessToken, hydrated, profiles, setSession } = useAuthStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const pinLogin = useMutation(trpc.auth.pinLogin.mutationOptions({ onSuccess: setSession }));

  /**
   * The failure handler has to know WHICH profile was submitted, and an observer-level `onError`
   * cannot: react-query hands a still-pending mutation the newest render's options, so a handler
   * closing over `selected` reads whichever card was tapped last rather than the one it is
   * reporting on. On a shared tablet that is destructive — an UNAUTHORIZED for a dead profile
   * would delete a colleague's live card and revoke their token. Per-call callbacks capture the
   * target at submit time, so the two can never disagree.
   */
  const submit = (profile: Profile) =>
    pinLogin.mutate(
      { refreshToken: profile.refreshToken, pin },
      {
        onError: (error) => {
          // Every PIN failure is UNAUTHORIZED, so the code alone cannot say whether the card is
          // still good. `reason: 'INVALID_PIN'` means the profile is fine and the digits were not
          // — keep it. Anything else means the profile is dead (expired, revoked, no PIN).
          // Cast: the generated contract is built without the formatter, so `reason` is not in
          // the inferred error type. Same reason `lib/trpc.ts` casts.
          const data = error.data as { code?: string; reason?: string } | undefined;
          if (data?.code === 'UNAUTHORIZED' && data.reason !== 'INVALID_PIN') {
            removeProfile(profile.user.id);
            setSelected((id) => (id === profile.user.id ? null : id));
          }
          setPin('');
          setMessage(error.message);
        },
      },
    );

  if (!hydrated) return <ActivityIndicator style={styles.center} />;
  if (accessToken) return <Redirect href="/" />;

  const list = Object.values(profiles);
  const current = selected ? profiles[selected] : undefined;

  const confirmRemove = (userId: string, name: string) =>
    Alert.alert(`Remove ${name}?`, 'They will need their password to sign in here again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeProfile(userId);
          setSelected((id) => (id === userId ? null : id));
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Who is this?</Text>

      {list.length === 0 && <Text style={styles.hint}>No one has signed in on this tablet yet.</Text>}

      <View style={styles.grid}>
        {list.map(({ user }) => (
          <Pressable
            key={user.id}
            // Switching cards mid-check would leave a PIN typed for one user submitted against
            // another, and a reply for the old card landing against the new selection.
            disabled={pinLogin.isPending}
            style={[styles.card, selected === user.id && styles.cardSelected]}
            onPress={() => {
              setSelected(user.id);
              setPin('');
              setMessage(null);
            }}
            onLongPress={() => confirmRemove(user.id, user.name)}
          >
            <Text style={styles.cardName}>{user.name}</Text>
            {/* `name` has no unique constraint — two staff called "John Smith" would otherwise get
                two identical cards. The username is what actually distinguishes them. */}
            <Text style={styles.cardUser}>@{user.username}</Text>
          </Pressable>
        ))}
      </View>

      {current && (
        <View style={styles.pinBox}>
          <Text>PIN for {current.user.name}</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoFocus
            placeholder="••••"
          />
          <Button
            title={pinLogin.isPending ? 'Checking…' : 'Enter'}
            disabled={pinLogin.isPending || !/^\d{6}$/.test(pin)}
            onPress={() => submit(current)}
          />
        </View>
      )}

      {message && <Text style={styles.error}>{message}</Text>}

      <View style={styles.spacer} />
      <Button title="Sign in with password" onPress={() => router.push('/login')} />
      <Text style={styles.hint}>Long-press a name to remove it from this tablet.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { padding: 20, minWidth: 140, borderWidth: 1, borderColor: '#ccc', borderRadius: 12 },
  cardSelected: { borderColor: '#208AEF', borderWidth: 2 },
  cardName: { fontSize: 18, fontWeight: '500' },
  cardUser: { color: '#666', fontSize: 13 },
  pinBox: { gap: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 24,
    letterSpacing: 8,
  },
  error: { color: '#c00' },
  hint: { color: '#666' },
  spacer: { height: 8 },
});
