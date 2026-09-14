import { Platform, View, type ViewProps } from 'react-native';

export interface CardProps extends Omit<ViewProps, 'className'> {
  shadow?: boolean;
  className?: string;
}

export function Card({ shadow = true, className, style, ...props }: CardProps) {
  return (
    <View
      // Android draws depth from `elevation` (and clips `boxShadow` to it on the old
      // architecture), so it gets that instead — one or the other, never both, or the card
      // carries two stacked shadows. The caller's style stays last so it can still override.
      style={[
        shadow &&
          Platform.select({
            android: { elevation: 6, shadowColor: '#CDD0DF' },
            default: { boxShadow: '0px 2px 48px 0px #CDD0DF66' },
          }),
        style,
      ]}
      className={`gap-4 rounded-2xl bg-surface p-4 ${className ?? ''}`}
      {...props}
    />
  );
}
