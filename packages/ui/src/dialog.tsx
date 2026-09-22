import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

// Rest props land on the popup, which renders a <div> — hence ComponentProps<'div'> rather than
// <'dialog'>. `title` and `children` are ours, so they are omitted from the inherited set.
export interface DialogProps extends Omit<ComponentProps<'div'>, 'className' | 'title' | 'children'> {
  open: boolean;
  /** The only way this closes — Esc and outside presses route here, they never close it themselves. */
  onClose: () => void;
  title?: ReactNode;
  /** Defaults off for a blocking dialog: an X is a manual close, which is what blocking forbids. */
  closeButton?: boolean;
  footer?: ReactNode;
  /** Esc and outside presses do nothing. The caller's own buttons are the only exit. */
  blocking?: boolean;
  /**
   * Base UI's prop, minus its `'trap-focus'` third state: `true` inerts the page behind a backdrop
   * and locks its scroll, `false` leaves the page usable — and with no backdrop to press and no
   * focus trap, `blocking` says much less there.
   */
  modal?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  closeButton,
  footer,
  blocking = false,
  modal = true,
  className,
  children,
  ...props
}: DialogProps) {
  const showClose = closeButton ?? !blocking;

  return (
    <BaseDialog.Root
      open={open}
      modal={modal}
      // Outside presses — and, when non-modal, focus leaving — are refused with the prop rather
      // than in the handler below, so Base UI never begins a dismissal it would have to undo.
      disablePointerDismissal={blocking}
      onOpenChange={(nextOpen, eventDetails) => {
        // Nothing here opens the dialog; `open` is the caller's to set, so this only ever closes.
        if (!nextOpen) {
          // Esc is the one dismissal `disablePointerDismissal` does not cover. `'close-press'` is
          // the X below, which a caller can still opt into on a blocking dialog.
          if (blocking && eventDetails.reason !== 'close-press') return;
          onClose();
        }
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 bg-ink-primary/40" />
        {/* A native <dialog> centred itself with `m-auto`; a popup needs a centring box. The
            padding here is the old `w-[calc(100%-2rem)]` and `max-h-[calc(100dvh-4rem)]`. */}
        <BaseDialog.Viewport className="fixed inset-0 flex items-center justify-center overflow-hidden px-4 py-8">
          <BaseDialog.Popup
            className={`relative flex max-h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface text-ink-primary shadow-[0px_2px_48px_0px_#CDD0DF66] ${className ?? ''}`}
            {...props}
          >
            {(title || showClose) && (
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-6 py-4">
                {/* Rendered only when there is a title: an empty Dialog.Title would label the
                    dialog with an empty string, where the old code left aria-labelledby unset. */}
                {title && <BaseDialog.Title className="text-base font-semibold">{title}</BaseDialog.Title>}
                {showClose && (
                  <BaseDialog.Close
                    aria-label="Tutup"
                    // `ml-auto` keeps the X on the right when it is the header's only child.
                    className="-mr-2 ml-auto rounded-full p-2 text-ink-tertiary hover:bg-primary-lighter hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
                  >
                    <X className="size-4" />
                  </BaseDialog.Close>
                )}
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-6">{children}</div>

            {footer && (
              <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
                {footer}
              </footer>
            )}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
