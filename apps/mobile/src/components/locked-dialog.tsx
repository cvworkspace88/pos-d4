import { Modal, Text, View } from 'react-native';
import { LOCKED_DIALOG } from '@repo/api-contract';
import { Button } from '@ui/button';

/** Too many wrong passwords or PINs (`isLocked`): says to wait or ask a manager. One way out. */
export function LockedDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-ink-primary/40 p-6">
        <View testID="locked-dialog" className="w-full max-w-md gap-4 rounded-3xl bg-surface p-6">
          <Text className="font-poppins-bold text-xl text-ink-primary">{LOCKED_DIALOG.title}</Text>
          <Text className="font-poppins text-base text-ink-secondary">{LOCKED_DIALOG.message}</Text>
          <Button testID="locked-dialog-ok" size="lg" onPress={onClose}>
            {LOCKED_DIALOG.button}
          </Button>
        </View>
      </View>
    </Modal>
  );
}
