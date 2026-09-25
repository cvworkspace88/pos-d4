import { Separator as BaseSeparator } from '@base-ui/react/separator';
import type { ComponentProps } from 'react';

export interface SeparatorProps extends Omit<ComponentProps<typeof BaseSeparator>, 'className'> {
  className?: string;
}

/** A hairline between sections. Base UI supplies `role="separator"` and `aria-orientation`. */
export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={`shrink-0 bg-border-subtle data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch ${className ?? ''}`}
      {...props}
    />
  );
}
