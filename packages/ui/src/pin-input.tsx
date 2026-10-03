export interface PinInputProps {
  /** How many digits the PIN has, i.e. how many dots to draw. */
  length?: number;
  value: string;
  /** Paints the filled dots red — the last attempt was rejected. */
  invalid?: boolean;
  className?: string;
}

/** Web mirror of mobile's `PinInput`. Display only: digits come from a `Keypad` or the keyboard. */
export function PinInput({ length = 6, value, invalid, className }: PinInputProps) {
  return (
    <div
      role="img"
      aria-label={`${value.length} dari ${length} digit`}
      className={`flex justify-center gap-3 ${className ?? ''}`}
    >
      {Array.from({ length }, (_, index) => (
        <span
          key={index}
          className={`size-3 rounded-full ${index < value.length ? (invalid ? 'bg-danger' : 'bg-primary') : 'bg-border'}`}
        />
      ))}
    </div>
  );
}
