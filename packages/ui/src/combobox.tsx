import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Select } from './select';
import { rowVariants } from './text-field';

export interface ComboboxItem {
  value: string;
  /** Plain text: it is what the search matches and what the trigger shows once picked. */
  label: string;
}

export interface ComboboxProps {
  items: ComboboxItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Opens the list with a search field on top. Off, this is exactly `Select`. */
  searchable?: boolean;
  label?: ReactNode;
  /** Shown on the trigger while nothing is picked. */
  placeholder?: string;
  /** Shown in the search field at the top of the list. */
  searchPlaceholder?: string;
  /** Shown when nothing matches what was typed. */
  emptyText?: string;
  /** Shown below the field. Its presence marks the field invalid. */
  error?: ReactNode;
  disabled?: boolean;
  /** Names the trigger when there is no visible `label`. */
  'aria-label'?: string;
  className?: string;
}

/**
 * A `Select`-shaped picker that can open with a search field on top — for lists long enough that
 * typing beats scrolling. The trigger looks like `Select` either way; Base UI supplies the
 * filtering, keyboard and ARIA.
 */
export function Combobox({
  searchable = false,
  searchPlaceholder = 'Ketik untuk mencari…',
  emptyText = 'Tidak ditemukan. Ubah kata kunci.',
  ...props
}: ComboboxProps) {
  // Without search there is nothing Select does not already do; one list component, not two.
  if (!searchable) return <Select {...props} />;

  const { items, value, onValueChange, label, placeholder = 'Pilih', error, disabled, className } = props;
  return (
    <BaseCombobox.Root
      items={items}
      value={items.find((item) => item.value === value) ?? null}
      // Null only comes from clearing, which this component never offers.
      onValueChange={(next) => next && onValueChange(next.value)}
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1">
        {label && <BaseCombobox.Label className="text-sm text-ink-secondary">{label}</BaseCombobox.Label>}
        <BaseCombobox.Trigger
          aria-label={props['aria-label']}
          aria-invalid={error ? true : undefined}
          className={rowVariants({
            invalid: Boolean(error),
            disabled: Boolean(disabled),
            className: `w-full cursor-pointer justify-between text-left text-sm text-ink-primary outline-none focus-visible:border-primary data-[popup-open]:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted ${className ?? ''}`,
          })}
        >
          <span className="truncate">
            <BaseCombobox.Value placeholder={<span className="text-ink-muted">{placeholder}</span>} />
          </span>
          <BaseCombobox.Icon>
            <ChevronDown className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
          </BaseCombobox.Icon>
        </BaseCombobox.Trigger>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="z-50">
          <BaseCombobox.Popup className="flex max-h-80 min-w-[var(--anchor-width)] flex-col rounded-lg border border-border bg-surface shadow-md outline-none">
            <BaseCombobox.Input
              placeholder={searchPlaceholder}
              className="border-b border-border-muted bg-transparent px-3 py-2.5 text-sm text-ink-primary outline-none placeholder:text-ink-muted"
            />
            <BaseCombobox.Empty className="px-3 py-2 text-sm text-ink-tertiary empty:hidden">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="overflow-auto p-1">
              {(item: ComboboxItem) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-primary outline-none data-[highlighted]:bg-primary-lighter data-[selected]:font-medium"
                >
                  <span className="flex-1">{item.label}</span>
                  <BaseCombobox.ItemIndicator>
                    <Check className="size-4 text-primary" aria-hidden />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
