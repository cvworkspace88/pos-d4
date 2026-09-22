import type { ComponentProps } from 'react';

export interface SkeletonProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div aria-hidden className={`animate-pulse rounded bg-border-light ${className ?? ''}`} {...props} />
  );
}
