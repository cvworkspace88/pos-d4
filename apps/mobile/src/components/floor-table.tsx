import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { RouterOutputs } from '@repo/api-contract';

export type TableRow = RouterOutputs['table']['list'][number];

/** Group outline colour keyed by the head id, so a group keeps its colour across refetches. */
export const groupColor = (headId: string | null) =>
  headId ? `hsl(${parseInt(headId.slice(0, 6), 16) % 360}, 70%, 45%)` : '#999';

interface Props {
  table: TableRow;
  /** Canvas units; the parent applies its drag override before passing this. */
  position: { x: number; y: number };
  scale: number;
  editing: boolean;
  seats: number;
  color: string;
  reserved: boolean;
  selected: boolean;
  picked: boolean;
  onTap: (table: TableRow) => void;
  /** Called on the JS thread with the dropped position in canvas units, not yet clamped. */
  onDrop: (table: TableRow, x: number, y: number) => void;
}

export function FloorTable({
  table,
  position,
  scale,
  editing,
  seats,
  color,
  reserved,
  selected,
  picked,
  onTap,
  onDrop,
}: Props) {
  // Live drag offset in screen pixels, on the UI thread. Reset on drop; the parent's override then
  // moves `position` in the same frame so the table does not jump back.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(editing)
    .onUpdate((event) => {
      tx.value = event.translationX;
      ty.value = event.translationY;
    })
    .onEnd((event, success) => {
      tx.value = 0;
      ty.value = 0;
      // Not `success` = another gesture took over; the table snaps back and nothing is saved.
      if (!success) return;
      scheduleOnRN(
        onDrop,
        table,
        position.x + event.translationX / scale,
        position.y + event.translationY / scale,
      );
    });
  // `onStart` on a tap fires once it is recognised; `onEnd` would also fire for a failed tap.
  const tap = Gesture.Tap().onStart(() => scheduleOnRN(onTap, table));
  // Pan wins when the finger moves; a still finger falls through to tap. With editing off the pan
  // is disabled and every touch is a tap.
  const gesture = Gesture.Exclusive(pan, tap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.table,
          {
            left: position.x * scale,
            top: position.y * scale,
            width: table.w * scale,
            height: table.h * scale,
            borderRadius: 8,
            borderColor: color,
            borderWidth: selected ? 4 : 2,
            borderStyle: picked ? 'dashed' : 'solid',
          },
          animated,
        ]}
      >
        <Text style={styles.name}>{table.name}</Text>
        <Text style={styles.small}>{seats} seats</Text>
        {reserved && <Text style={styles.badge}>Reserved</Text>}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  table: { position: 'absolute', backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  name: { fontWeight: '600' },
  small: { fontSize: 12, color: '#444' },
  badge: { fontSize: 12, color: '#b45309' },
});
