import type { ComponentProps, ReactNode } from 'react';

export interface CardProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
  children?: ReactNode;
}

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-[0px_2px_48px_0px_#CDD0DF66] ${className ?? ''}`}
      {...props}
    />
  );
}
