import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { rowVariants } from './text-field';

export interface SelectItem {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  items: SelectItem[];
  value: string;
  onValueChange: (value: string) => void;
  label?: ReactNode;
  placeholder?: ReactNode;
  /** Shown below the field. Its presence marks the field invalid. */
  error?: ReactNode;
  disabled?: boolean;
  /** Names the trigger when there is no visible `label`. */
  'aria-label'?: string;
  className?: string;
}

/**
 * A `TextField`-shaped picker. The trigger is a <button>, not a native <select>, so the list can be
 * styled; Base UI supplies the keyboard, typeahead and ARIA. `items` also tells the trigger what
 * label to show for the current value.
 */
export function Select({
  items,
  value,
  onValueChange,
  label,
  placeholder,
  error,
  disabled,
  className,
  ...props
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      // Null only comes from clearing, which this component never offers.
      onValueChange={(next) => next !== null && onValueChange(next)}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1">
        {label && <BaseSelect.Label className="text-sm text-ink-secondary">{label}</BaseSelect.Label>}
        <BaseSelect.Trigger
          aria-label={props['aria-label']}
          aria-invalid={error ? true : undefined}
          className={rowVariants({
            invalid: Boolean(error),
            disabled: Boolean(disabled),
            className: `cursor-pointer justify-between text-left text-sm text-ink-primary outline-none focus-visible:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted ${className ?? ''}`,
          })}
        >
          <BaseSelect.Value
            placeholder={placeholder}
            className="truncate data-[placeholder]:text-ink-muted"
          />
          <BaseSelect.Icon>
            <ChevronDown className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup className="max-h-72 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-border bg-surface py-1 shadow-md outline-none">
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink-primary outline-none data-[highlighted]:bg-primary-lighter data-[selected]:font-medium"
                >
                  <BaseSelect.ItemText className="flex-1">{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check className="size-4 text-primary" aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
