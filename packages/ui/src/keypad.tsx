import { Delete } from 'lucide-react';
import { useEffect, useEffectEvent, type ReactNode } from 'react';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export interface KeypadProps {
  onPress: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
  /**
   * Also take digits and Backspace from the physical keyboard (a window listener). Opt in: only one
   * pad on screen should, and never one beside a text field.
   */
  keyboard?: boolean;
  className?: string;
}

function Key({
  onPress,
  disabled,
  muted,
  label,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      aria-label={label}
      className={`flex flex-1 items-center justify-center rounded-2xl border border-border-subtle py-4 text-2xl text-ink-primary transition-transform active:scale-[0.98] disabled:opacity-50 ${
        muted ? 'bg-surface-light active:bg-border-muted' : 'bg-surface active:bg-surface-light'
      }`}
    >
      {children}
    </button>
  );
}

/** Web mirror of mobile's `Keypad`, PIN layout only. Digits only; the caller owns the value. */
export function Keypad({ onPress, onBackspace, disabled, keyboard = false, className }: KeypadProps) {
  // An effect event: the listener binds once yet always calls the latest handlers.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (disabled) return;
    // A held key auto-repeats, Ctrl/Alt/Cmd+digit is a shortcut, and typing into a field is its own.
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return;
    if (/^\d$/.test(e.key)) onPress(e.key);
    else if (e.key === 'Backspace') onBackspace();
  });
  useEffect(() => {
    if (!keyboard) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard]);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      {ROWS.map((row) => (
        <div key={row[0]} className="flex gap-3">
          {row.map((digit) => (
            <Key key={digit} disabled={disabled} onPress={() => onPress(digit)}>
              {digit}
            </Key>
          ))}
        </div>
      ))}
      <div className="flex gap-3">
        {/* Holds the slot open so `0` stays under `8`, as on mobile. An amount pad adds its `000` key here. */}
        <div className="flex-1" />
        <Key disabled={disabled} onPress={() => onPress('0')}>
          0
        </Key>
        <Key muted label="Hapus" disabled={disabled} onPress={onBackspace}>
          <Delete className="size-6 text-ink-secondary" aria-hidden />
        </Key>
      </div>
    </div>
  );
}
