import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

/**
 * Inline status banner. One size only — the design has a single 12/16 padding — so there is no
 * `size` prop until a second one exists.
 */
const alertVariants = cva('rounded-[14px] px-4 py-3 text-sm', {
  variants: {
    variant: {
      primary: 'bg-primary-lighter text-primary',
      warning: 'bg-warning-lighter text-warning-dark',
      danger: 'bg-danger-light text-danger-dark',
      success: 'bg-success-light text-success-dark',
    },
  },
  defaultVariants: { variant: 'primary' },
});

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

export interface AlertProps extends Omit<ComponentProps<'div'>, 'className'> {
  variant?: AlertVariant;
  className?: string;
}

export function Alert({ variant = 'primary', className, role = 'status', ...props }: AlertProps) {
  return <div role={role} className={alertVariants({ variant, className })} {...props} />;
}

export { alertVariants };
