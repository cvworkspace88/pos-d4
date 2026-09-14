import { cva, type VariantProps } from 'class-variance-authority';
import { View, Text, type ViewProps } from 'react-native';

/** Mirrors the desktop alert. One size only — the design has a single 12/16 padding. */
const alertVariants = cva('rounded-[14px] px-4 py-3', {
  variants: {
    variant: {
      primary: 'bg-primary-lighter',
      warning: 'bg-warning-lighter',
      danger: 'bg-danger-light',
      success: 'bg-success-light',
    },
  },
  defaultVariants: { variant: 'primary' },
});

/** React Native colours text on the `Text` node, so the label carries its own variants. */
const alertLabelVariants = cva('font-poppins text-sm', {
  variants: {
    variant: {
      primary: 'text-primary',
      warning: 'text-warning-dark',
      danger: 'text-danger-dark',
      success: 'text-success-dark',
    },
  },
  defaultVariants: { variant: 'primary' },
});

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

export interface AlertProps extends Omit<ViewProps, 'children' | 'className'> {
  variant?: AlertVariant;
  className?: string;
  children: string;
}

export function Alert({ variant = 'primary', className, children, ...props }: AlertProps) {
  return (
    <View className={alertVariants({ variant, className })} {...props}>
      <Text className={alertLabelVariants({ variant })}>{children}</Text>
    </View>
  );
}

export { alertVariants, alertLabelVariants };
