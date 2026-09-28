import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { useId, type ReactNode } from 'react';

// State comes from Base UI as data attributes (`data-checked`, `data-disabled`), not pseudo-classes —
// same reason as `Checkbox`: the root is a <span>, not the <input>.
export interface RadioItem {
  value: string;
  label: ReactNode;
  /** A second, quieter line under the label. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** `Select`-shaped: the options as data, one row each. */
  items: RadioItem[];
  value: string;
  onValueChange: (value: string) => void;
  label?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function RadioGroup({
  items,
  value,
  onValueChange,
  label,
  disabled,
  className,
  ...props
}: RadioGroupProps) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span id={labelId} className="text-sm text-ink-secondary">
          {label}
        </span>
      )}
      <BaseRadioGroup
        value={value}
        onValueChange={(next) => onValueChange(next as string)}
        disabled={disabled}
        aria-labelledby={label ? labelId : undefined}
        aria-label={props['aria-label']}
        className={`flex flex-col gap-3 ${className ?? ''}`}
      >
        {items.map((item) => (
          <label
            key={item.value}
            className="flex cursor-pointer items-start gap-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
          >
            <Radio.Root
              value={item.value}
              disabled={item.disabled}
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light data-[checked]:border-primary"
            >
              <Radio.Indicator className="size-2.5 rounded-full bg-primary" />
            </Radio.Root>
            <span className="flex flex-col">
              <span className="text-ink-primary">{item.label}</span>
              {item.description && <span className="text-ink-tertiary">{item.description}</span>}
            </span>
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  );
}
