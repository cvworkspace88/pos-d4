import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-full border font-medium disabled:pointer-events-none transition-[background-color,border-color,transform] enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light',
  {
    variants: {
      variant: {
        default: 'bg-primary border-transparent text-white hover:bg-primary-dark active:bg-primary-dark',
        ghost:
          'bg-transparent border-transparent text-ink-primary hover:bg-primary-lighter active:bg-primary-light',
        outline:
          'bg-transparent text-ink-primary border-primary hover:bg-primary-lighter active:bg-primary-light',
        soft: 'bg-primary-light border-transparent text-primary-dark hover:bg-primary-lighter active:bg-primary-light',
        danger: 'bg-danger border-transparent text-white hover:bg-danger-dark active:bg-danger-dark',
        disabled: 'bg-pebble text-ink-muted border-pebble cursor-not-allowed',
      },
      size: {
        lg: 'px-8 py-4 text-base',
        md: 'px-6 py-3 text-sm',
        sm: 'px-5 py-2 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

/** `disabled` drives its own variant, so it is not selectable through `variant`. */
export type ButtonVariant = Exclude<
  VariantProps<typeof buttonVariants>['variant'],
  'disabled' | null | undefined
>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and puts a spinner before its label, keeping the variant's colour. */
  loading?: boolean;
  className?: string;
}

export function Button({
  variant = 'default',
  size = 'md',
  disabled,
  loading = false,
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonVariants({ variant: disabled ? 'disabled' : variant, size, className })}
      {...props}
    >
      {loading && <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export { buttonVariants };
