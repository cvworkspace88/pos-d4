import type { ReactNode } from 'react';
import { StateBox, type StateBoxVariant } from './illustrations/state-box';

export interface StateMessageLayoutProps {
  /** Tint of the placeholder art. Matches the meaning of the copy: `danger` for a failure, etc. */
  tone?: StateBoxVariant;
  title: string;
  description?: ReactNode;
  /** Zero, one, or two `Button`s. Laid out in a row; the primary one comes first. */
  children?: ReactNode;
  className?: string;
}

/**
 * The centred art + title + explanation + actions block every non-loading list state shares:
 * empty, emptied by a filter, failed, offline, forbidden. Only the tone and the copy differ, so
 * there is one component and no per-state variant.
 *
 * Loading is deliberately not one of them — a skeleton mirrors the shape of the data instead of
 * replacing it with a message, so it is its own component.
 */
export function StateMessageLayout({
  tone = 'primary',
  title,
  description,
  children,
  className,
}: StateMessageLayoutProps) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className ?? ''}`}>
      <StateBox variant={tone} />
      <h3 className="mt-6 text-base font-semibold text-ink-primary">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-ink-secondary">{description}</p>}
      {children && <div className="mt-5 flex items-center justify-center gap-3">{children}</div>}
    </div>
  );
}
