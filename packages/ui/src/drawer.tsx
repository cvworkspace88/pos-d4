import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/**
 * A full-height panel from the right edge, for records with more fields than a `Dialog` holds. Same
 * props and the same closing contract as `Dialog`: every dismissal — Esc, outside press, the X, a
 * swipe to the right — is routed to `onClose`, never closes it by itself.
 */
export interface DrawerProps extends Omit<ComponentProps<'div'>, 'className' | 'title' | 'children'> {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Defaults off for a blocking drawer, as in `Dialog`. */
  closeButton?: boolean;
  /** Pinned under the scrolling body, so the save button stays in reach on a long form. */
  footer?: ReactNode;
  /** Esc, outside presses and swipes do nothing. The caller's own buttons are the only exit. */
  blocking?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  closeButton,
  footer,
  blocking = false,
  className,
  children,
  ...props
}: DrawerProps) {
  const showClose = closeButton ?? !blocking;

  return (
    <BaseDrawer.Root
      open={open}
      swipeDirection="right"
      disablePointerDismissal={blocking}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen) {
          // Controlled: refusing here leaves `open` true, so a swipe springs back.
          if (blocking && eventDetails.reason !== 'close-press') return;
          onClose();
        }
      }}
    >
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0 bg-ink-primary/40 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDrawer.Viewport className="fixed inset-0 flex justify-end">
          <BaseDrawer.Popup
            className={`flex h-full w-full max-w-xl flex-col bg-surface text-ink-primary shadow-[0px_2px_48px_0px_#CDD0DF66] [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:[transform:translateX(100%)] data-[starting-style]:[transform:translateX(100%)] data-[swiping]:select-none data-[swiping]:duration-0 ${className ?? ''}`}
            {...props}
          >
            {(title || showClose) && (
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-6 py-4">
                {title && <BaseDrawer.Title className="text-base font-semibold">{title}</BaseDrawer.Title>}
                {showClose && (
                  <BaseDrawer.Close
                    aria-label="Tutup"
                    className="-mr-2 ml-auto rounded-full p-2 text-ink-tertiary hover:bg-primary-lighter hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
                  >
                    <X className="size-4" />
                  </BaseDrawer.Close>
                )}
              </header>
            )}

            <BaseDrawer.Content className="min-h-0 flex-1 overflow-auto overscroll-contain p-6">
              {children}
            </BaseDrawer.Content>

            {footer && (
              <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
                {footer}
              </footer>
            )}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
