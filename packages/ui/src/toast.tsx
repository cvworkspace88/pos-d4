import { Toast as BaseToast } from '@base-ui/react/toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Tone comes from the toast's `type` — Base UI's own field for "style this one differently" — so a
 * caller writes `toast.add({ type: 'danger', title })` and never touches a class. An unknown type
 * keeps the neutral card in the base, which is why the colours only ever override.
 */
const toastVariants = cva(
  'pointer-events-auto flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface px-4 py-3 text-sm text-ink-primary shadow-[0px_2px_16px_0px_#CDD0DF66] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-primary-lighter text-primary',
        info: 'border-transparent bg-info/10 text-info',
        warning: 'border-transparent bg-warning-lighter text-warning-dark',
        danger: 'border-transparent bg-danger-light text-danger-dark',
        success: 'border-transparent bg-success-light text-success-dark',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export type ToastVariant = NonNullable<VariantProps<typeof toastVariants>['variant']>;

export interface ToasterProps extends ComponentProps<typeof BaseToast.Provider> {
  children?: ReactNode;
}

/**
 * Provider and viewport in one mount: `useToast` needs the provider above it, the viewport needs to
 * be inside it, and nothing has ever wanted the two in different places.
 */
export function Toaster({ children, ...props }: ToasterProps) {
  return (
    <BaseToast.Provider {...props}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();

  return toasts.map((toast) => (
    <BaseToast.Root
      key={toast.id}
      toast={toast}
      className={toastVariants({ variant: toast.type as ToastVariant | undefined })}
    >
      <div className="min-w-0 flex-1">
        {toast.title && <BaseToast.Title className="font-semibold" />}
        {toast.description && <BaseToast.Description className="[&:not(:first-child)]:mt-0.5" />}
      </div>
      <BaseToast.Close
        aria-label="Tutup"
        className="-mr-1 -mt-1 shrink-0 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
      >
        <X className="size-4" />
      </BaseToast.Close>
    </BaseToast.Root>
  ));
}

/** `add`, `close`, `update`, `promise`. Must be called under a {@link Toaster}. */
export const useToast = BaseToast.useToastManager;

export { toastVariants };
