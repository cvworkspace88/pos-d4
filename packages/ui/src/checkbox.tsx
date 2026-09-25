import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

// State comes from Base UI as data attributes (`data-checked`, `data-indeterminate`,
// `data-disabled`), not pseudo-classes — same reason as `Switch`: the root is not the <input>.
export interface CheckboxProps extends Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className'> {
  /** Text beside the box. The whole row is the click target when present. */
  label?: ReactNode;
  className?: string;
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root
      className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 ${label ? '' : (className ?? '')}`}
      {...props}
    >
      {/* Unmounted while unchecked; shown for checked and indeterminate alike. */}
      <BaseCheckbox.Indicator className="flex text-surface">
        {props.indeterminate ? (
          <Minus className="size-3.5" strokeWidth={3} aria-hidden />
        ) : (
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) return box;

  return (
    <label
      className={`flex items-center gap-3 text-sm text-ink-secondary has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-ink-muted ${className ?? ''}`}
    >
      {box}
      {label}
    </label>
  );
}
