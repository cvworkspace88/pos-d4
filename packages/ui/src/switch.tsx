import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ComponentProps } from 'react';

// State comes from Base UI as data attributes (`data-checked`, `data-unchecked`, `data-disabled`),
// not CSS pseudo-classes: the root renders a <span> with a hidden <input>, so `:disabled` and
// `:checked` never match it.
export interface SwitchProps extends Omit<ComponentProps<typeof BaseSwitch.Root>, 'className'> {
  className?: string;
}

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light data-[checked]:bg-primary data-[unchecked]:bg-pebble data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 ${className ?? ''}`}
      {...props}
    >
      <BaseSwitch.Thumb className="size-5 rounded-full bg-surface shadow-sm transition-transform data-[checked]:translate-x-5" />
    </BaseSwitch.Root>
  );
}
