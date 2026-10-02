import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '@ui/alert';
import { Button } from '@ui/button';
import { Keypad } from '@ui/keypad';
import { PinInput } from '@ui/pin-input';
import type { ApprovalControl } from '@repo/hooks/use-approval';
import { useTRPC } from '@/lib/trpc';

const PIN_LENGTH = 6;

/** "Minta akses": a manager picks their name and enters their PIN on this tablet (US-010). */
export function ApprovalDialog({ approval }: { approval: ApprovalControl }) {
  const trpc = useTRPC();
  const open = approval.pending !== null;
  const approvers = useQuery({
    ...trpc.approval.approvers.queryOptions({ permission: approval.permission }),
    enabled: open,
  });
  const [approverUserId, setApprover] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const close = () => {
    setApprover(null);
    setPin('');
    setReason('');
    setError(null);
    approval.close();
  };

  const send = async (fullPin: string) => {
    if (!approverUserId) return;
    setBusy(true);
    try {
      await approval.submit({ approverUserId, pin: fullPin, reason: reason.trim() || undefined });
      close();
    } catch (caught) {
      setPin('');
      setError((caught as Error).message); // the server's text, "Sisa N percobaan" included
    } finally {
      setBusy(false);
    }
  };

  const press = (digit: string) => {
    if (busy || !approverUserId) return;
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setError(null);
    setPin(next);
    if (next.length === PIN_LENGTH) void send(next);
  };

  const list = approvers.data ?? [];

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView className="flex-1 gap-4 bg-surface-canvas p-6">
        <Text className="font-poppins-bold text-xl text-ink-primary">Minta akses</Text>

        {approvers.isSuccess && list.length === 0 ? (
          <Text className="font-poppins text-ink-secondary">
            Tidak ada penyetuju dengan PIN di outlet ini.
          </Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {list.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => {
                  setApprover(a.id);
                  setPin('');
                  setError(null);
                }}
                className={`rounded-xl border px-4 py-3 ${
                  approverUserId === a.id
                    ? 'border-primary bg-primary-lighter'
                    : 'border-border-subtle bg-surface'
                }`}
              >
                <Text className="font-poppins-medium text-ink-primary">{a.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {approvers.error && <Alert variant="danger">{approvers.error.message}</Alert>}

        {approverUserId && (
          <View className="w-full max-w-sm gap-4 self-center">
            <TextInput
              placeholder="Alasan (opsional)"
              value={reason}
              onChangeText={setReason}
              maxLength={200}
              className="rounded-xl border border-border-subtle bg-surface px-4 py-3 font-poppins"
            />
            <PinInput length={PIN_LENGTH} value={pin} invalid={Boolean(error)} />
            <Keypad onPress={press} onBackspace={() => setPin((p) => p.slice(0, -1))} disabled={busy} />
          </View>
        )}

        {error && <Alert variant="danger">{error}</Alert>}
        <Button variant="outline" onPress={close}>
          Tutup
        </Button>
      </SafeAreaView>
    </Modal>
  );
}
