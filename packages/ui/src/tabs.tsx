import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled. Leave out for uncontrolled; the first enabled tab opens by default. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

/**
 * An underlined tab strip over its panels, `items`-driven like `Select`. Base UI supplies the arrow
 * keys and ARIA; the active tab shows as `data-active`, and the indicator slides using the
 * `--active-tab-*` variables it sets.
 */
export function Tabs({ items, value, defaultValue, onValueChange, className }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange && ((next) => onValueChange(next as string))}
      className={`flex min-h-0 flex-col gap-4 ${className ?? ''}`}
    >
      <BaseTabs.List className="relative flex shrink-0 gap-1 border-b border-border-subtle">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className="cursor-pointer px-4 py-2 text-sm font-medium text-ink-tertiary outline-none transition-colors hover:text-ink-primary focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-primary-light data-[active]:text-primary data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted"
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="absolute -bottom-px left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] rounded-full bg-primary transition-[left,width]" />
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="min-h-0 flex-1 outline-none">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
