import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, Text, type PressableProps } from 'react-native';

/**
 * Mirrors the desktop button. `disabled` is a variant rather than an override so the disabled
 * look never ships alongside the enabled one — two conflicting `bg-*` classes would be resolved
 * by the generated stylesheet's order, not by the order we list them here. Every variant names
 * its own border colour for the same reason. There is no hover on a tablet, so the default
 * variant darkens on press instead.
 */
const buttonVariants = cva('items-center justify-center rounded-full border', {
  variants: {
    variant: {
      default: 'bg-primary border-transparent active:bg-primary-dark',
      ghost: 'bg-transparent border-transparent active:bg-primary-lighter',
      outline: 'bg-transparent border-primary active:bg-primary-lighter',
      soft: 'bg-primary-light border-transparent active:bg-primary-lighter',
      danger: 'bg-danger border-transparent active:bg-danger-dark',
      disabled: 'bg-pebble border-pebble',
    },
    size: {
      lg: 'px-8 py-4',
      md: 'px-6 py-3',
      sm: 'px-5 py-2',
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

/** React Native colours text on the `Text` node, so the label carries its own variants. */
const buttonLabelVariants = cva('text-center font-poppins-medium', {
  variants: {
    variant: {
      default: 'text-white',
      ghost: 'text-ink-primary',
      outline: 'text-ink-primary',
      soft: 'text-primary-dark',
      danger: 'text-white',
      disabled: 'text-ink-muted',
    },
    size: {
      lg: 'text-base',
      md: 'text-sm',
      sm: 'text-sm',
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

/** `disabled` drives its own variant, so it is not selectable through `variant`. */
export type ButtonVariant = Exclude<
  VariantProps<typeof buttonVariants>['variant'],
  'disabled' | null | undefined
>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends Omit<PressableProps, 'children' | 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: string;
}

export function Button({
  variant = 'default',
  size = 'md',
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const resolved = disabled ? 'disabled' : variant;
  return (
    <Pressable
      disabled={disabled}
      className={buttonVariants({ variant: resolved, size, className })}
      {...props}
    >
      <Text className={buttonLabelVariants({ variant: resolved, size })}>{children}</Text>
    </Pressable>
  );
}

export { buttonVariants, buttonLabelVariants };
