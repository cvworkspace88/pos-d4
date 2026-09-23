import type { ReactNode } from 'react';

const tones = {
  success: 'bg-success-light text-success-dark',
  warning: 'bg-warning-light text-warning-dark',
  danger: 'bg-danger-light text-danger-dark',
  neutral: 'bg-surface-canvas text-ink-tertiary',
};

export interface PillProps {
  tone?: keyof typeof tones;
  className?: string;
  children: ReactNode;
}

export function Pill({ tone = 'neutral', className, children }: PillProps) {
  return (
    <span
      className={`inline-flex justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
