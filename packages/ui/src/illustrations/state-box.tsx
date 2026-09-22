import type { ComponentProps } from 'react';

/**
 * The tint behind the card, and the accent bar inside it. Hex rather than Tailwind classes
 * because an SVG `fill` cannot take one; each value is a token from @repo/tailwind-config, so a
 * palette edit has to be repeated here.
 */
const FILLS = {
  primary: '#E7ECFF', // primary-lighter
  danger: '#FFE0E4', // danger-light
  warning: '#FFF4E5', // warning-light
  teal: '#D1FAFF', // teal-lighter
  lavender: '#EDDFF7', // lavender-light
} as const;

export type StateBoxVariant = keyof typeof FILLS;

export interface StateBoxProps extends ComponentProps<'svg'> {
  variant?: StateBoxVariant;
}

/**
 * Placeholder art for a state with no list to show — empty, filtered down to nothing, failed to
 * load, offline, or not permitted. One drawing, five tints — the title below it says which.
 *
 * Inlined rather than shipped as a file: this package exports source with no build step and no
 * asset pipeline, so a `.svg` here would need a copy in every app's `public/`. Decorative by
 * default — the surrounding copy carries the meaning — so it is hidden from screen readers
 * unless a caller passes its own `aria-label` and `aria-hidden={false}`.
 */
export function StateBox({ variant = 'primary', 'aria-hidden': ariaHidden = true, ...props }: StateBoxProps) {
  const fill = FILLS[variant];
  return (
    <svg
      width="144"
      height="80"
      viewBox="0 0 144 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      {...props}
    >
      <rect width="144" height="80" rx="14" fill={fill} />
      <rect x="20" y="16" width="104" height="48" rx="6" fill="white" />
      <rect x="32" y="26" width="80" height="6" rx="3" fill="#DDDFEB" />
      <rect x="32" y="37" width="64" height="6" rx="3" fill="#DDDFEB" />
      <rect x="32" y="48" width="80" height="6" rx="3" fill={fill} />
    </svg>
  );
}
