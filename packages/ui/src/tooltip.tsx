import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ComponentProps, ReactNode } from 'react';

// Rest props land on the trigger, a <button> — so it takes focus and the tip opens from the keyboard
// too. Name it with `aria-label` when its children are only an icon.
export interface TooltipProps extends Omit<
  ComponentProps<typeof BaseTooltip.Trigger>,
  'className' | 'content'
> {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function Tooltip({ content, side = 'top', className, children, ...props }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        className={`inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light ${className ?? ''}`}
        {...props}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8}>
          <BaseTooltip.Popup className="max-w-xs rounded-lg bg-ink-primary px-3 py-2 text-xs text-white shadow-md">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
