import { View } from 'react-native';

export interface PinInputProps {
  /** How many digits the PIN has, i.e. how many dots to draw. */
  length?: number;
  value: string;
  /** Paints the filled dots red — the last attempt was rejected. */
  invalid?: boolean;
  className?: string;
}

/** Display only: the digits arrive from a `Keypad`, never from the system keyboard. */
export function PinInput({ length = 6, value, invalid, className }: PinInputProps) {
  return (
    <View className={`flex-row justify-center gap-3 ${className ?? ''}`}>
      {Array.from({ length }, (_, index) => (
        <View
          key={index}
          className={`h-3 w-3 rounded-full ${
            index < value.length ? (invalid ? 'bg-danger' : 'bg-primary') : 'bg-border'
          }`}
        />
      ))}
    </View>
  );
}
