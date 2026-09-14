import { cva } from 'class-variance-authority';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

/**
 * Mirrors the desktop text field. The border lives on the row rather than the input so an
 * adornment (the password toggle) sits inside the box and still lights up with it on focus.
 */
const rowVariants = cva('flex-row items-center gap-2 rounded-xl border px-4 py-3', {
  variants: {
    invalid: {
      true: 'border-danger',
      false: 'border-border focus:border-primary',
    },
    disabled: {
      true: 'bg-surface-canvas',
      false: 'bg-surface',
    },
  },
  defaultVariants: { invalid: false, disabled: false },
});

export interface TextFieldProps extends Omit<TextInputProps, 'className' | 'editable'> {
  label?: string;
  /** Shown below the field, in place of the helper text. Its presence marks the field invalid. */
  error?: string;
  helperText?: string;
  /** Rendered inside the field, after the input. */
  adornment?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TextField({
  label,
  error,
  helperText,
  adornment,
  disabled,
  className,
  style,
  ...props
}: TextFieldProps) {
  const message = error ?? helperText;

  return (
    // gap-1 is the 4px the design puts between the label and the field.
    <View className="gap-1">
      {label && <Text className="font-poppins text-sm text-ink-secondary">{label}</Text>}
      <View className={rowVariants({ invalid: Boolean(error), disabled: Boolean(disabled), className })}>
        <TextInput
          editable={!disabled}
          placeholderTextColor="#6B7280"
          style={[{ includeFontPadding: false, textAlignVertical: 'center' }, style]}
          className={`h-6 flex-1 p-0 font-poppins text-base leading-6 ${disabled ? 'text-ink-muted' : 'text-ink-primary'}`}
          {...props}
        />
        {adornment}
      </View>
      {message && (
        <Text className={`font-poppins text-xs ${error ? 'text-danger' : 'text-ink-muted'}`}>{message}</Text>
      )}
    </View>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'adornment' | 'secureTextEntry'>;

/** A `TextField` that can reveal what was typed. */
export function PasswordField({ disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextField
      secureTextEntry={!visible}
      disabled={disabled}
      autoCapitalize="none"
      autoCorrect={false}
      adornment={
        <Pressable
          hitSlop={8}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
          onPress={() => setVisible((v) => !v)}
        >
          <Icon size={20} color={disabled ? '#6B7280' : '#676879'} />
        </Pressable>
      }
      {...props}
    />
  );
}

export { rowVariants };
