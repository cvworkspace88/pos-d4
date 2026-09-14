import { Delete } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export interface KeypadProps {
  onPress: (digit: string) => void;
  onBackspace: () => void;
  /** `currency` adds the `000` key that the amount pads have; `pin` leaves that slot empty. */
  format?: 'pin' | 'currency';
  disabled?: boolean;
  className?: string;
}

interface KeyProps {
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}

function Key({ onPress, disabled, muted, children }: KeyProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center justify-center rounded-2xl border border-border-subtle py-4 active:scale-[0.98] ${
        muted ? 'bg-surface-light active:bg-border-muted' : 'bg-surface active:bg-surface-light'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {children}
    </Pressable>
  );
}

/** Digits only. The caller owns the value, so the same pad drives a PIN and an amount. */
export function Keypad({ onPress, onBackspace, format = 'pin', disabled, className }: KeypadProps) {
  return (
    <View className={`gap-3 ${className ?? ''}`}>
      {ROWS.map((row) => (
        <View key={row[0]} className="flex-row gap-3">
          {row.map((digit) => (
            <Key key={digit} disabled={disabled} onPress={() => onPress(digit)}>
              <Text className="font-poppins text-2xl text-ink-primary">{digit}</Text>
            </Key>
          ))}
        </View>
      ))}

      <View className="flex-row gap-3">
        {format === 'currency' ? (
          <Key disabled={disabled} onPress={() => onPress('000')}>
            <Text className="font-poppins text-xl text-ink-primary">000</Text>
          </Key>
        ) : (
          // Holds the slot open so `0` stays under `8`, as in the design.
          <View className="flex-1" />
        )}
        <Key disabled={disabled} onPress={() => onPress('0')}>
          <Text className="font-poppins text-2xl text-ink-primary">0</Text>
        </Key>
        <Key muted disabled={disabled} onPress={onBackspace}>
          <Delete size={22} color="#676879" />
        </Key>
      </View>
    </View>
  );
}
