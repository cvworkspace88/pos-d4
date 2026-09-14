import { cva, type VariantProps } from 'class-variance-authority';
import { Text, View } from 'react-native';

/** Tints are picked by id so a face keeps its colour between visits. */
const TINTS = [
  'bg-pink-light',
  'bg-teal-lighter',
  'bg-lavender-light',
  'bg-primary-light',
  'bg-success-light',
  'bg-warning-lighter',
];

const avatarVariants = cva('items-center justify-center rounded-full', {
  variants: { size: { md: 'h-16 w-16', lg: 'h-20 w-20' } },
  defaultVariants: { size: 'md' },
});

const initialsVariants = cva('font-poppins-semibold text-ink-primary', {
  variants: { size: { md: 'text-xl', lg: 'text-2xl' } },
  defaultVariants: { size: 'md' },
});

export type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>['size']>;

export interface AvatarProps {
  name: string;
  /** What the tint is derived from; the user id, so two namesakes still differ. */
  seed: string;
  size?: AvatarSize;
  className?: string;
}

/** "Andi Saputra" → "AS". A single-word name gives one letter rather than a letter and a blank. */
function initialsOf(name: string) {
  const [first = '', second = ''] = name.trim().split(/\s+/);
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

function tintOf(seed: string) {
  const sum = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0);
  return TINTS[sum % TINTS.length];
}

export function Avatar({ name, seed, size = 'md', className }: AvatarProps) {
  return (
    <View className={avatarVariants({ size, className: `${tintOf(seed)} ${className ?? ''}` })}>
      <Text className={initialsVariants({ size })}>{initialsOf(name)}</Text>
    </View>
  );
}

export { avatarVariants };
