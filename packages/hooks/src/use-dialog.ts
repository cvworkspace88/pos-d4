import { useState } from 'react';

export interface Dialog {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Open/close state for a dialog, with the cleanup attached to it. `onClose` runs on every close,
 * which is where a form reset and a mutation reset belong — otherwise reopening the dialog shows
 * the last attempt's values and its error.
 *
 * `close` is a fresh function each render, so it is not safe in a dependency array; it is meant for
 * `onClick` and `onClose` props.
 */
export function useDialog(onClose?: () => void): Dialog {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => {
      setIsOpen(false);
      onClose?.();
    },
  };
}
