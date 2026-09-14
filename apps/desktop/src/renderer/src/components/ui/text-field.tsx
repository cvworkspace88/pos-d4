import { cva } from 'class-variance-authority';
import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

/**
 * Labelled text input. Label, error and helper text are all optional, so one component covers a
 * bare input and a fully annotated one. The border lives on the row rather than the input so an
 * adornment (the password toggle) sits inside the box and still lights up with it on focus.
 */
const rowVariants = cva('flex items-center gap-2 rounded-xl border px-4 py-3', {
  variants: {
    invalid: {
      true: 'border-danger focus-within:border-danger',
      false: 'border-border focus-within:border-primary',
    },
    disabled: {
      true: 'bg-surface-canvas',
      false: 'bg-surface',
    },
  },
  defaultVariants: { invalid: false, disabled: false },
});

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'className'> {
  label?: ReactNode;
  /** Shown below the field, in place of the helper text. Its presence marks the field invalid. */
  error?: ReactNode;
  helperText?: ReactNode;
  /** Rendered inside the field, after the input. */
  adornment?: ReactNode;
  className?: string;
}

export function TextField({
  label,
  error,
  helperText,
  adornment,
  id,
  disabled,
  className,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? helperText;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm text-ink-secondary">
          {label}
        </label>
      )}
      <div className={rowVariants({ invalid: Boolean(error), disabled: Boolean(disabled), className })}>
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className="w-full bg-transparent text-base text-ink-primary outline-none placeholder:text-ink-muted disabled:cursor-not-allowed disabled:text-ink-muted"
          {...props}
        />
        {adornment}
      </div>
      {message && (
        <p id={messageId} className={error ? 'text-xs text-danger' : 'text-xs text-ink-muted'}>
          {message}
        </p>
      )}
    </div>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'adornment'>;

/** A `TextField` that can reveal what was typed. */
export function PasswordField({ disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextField
      type={visible ? 'text' : 'password'}
      disabled={disabled}
      adornment={
        <button
          type="button"
          disabled={disabled}
          // Not focusable by tab: the field it belongs to is the tab stop, and a reveal button is
          // not a step in filling the form.
          tabIndex={-1}
          aria-label={visible ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
          className="shrink-0 text-ink-tertiary disabled:text-ink-muted"
          onClick={() => setVisible((v) => !v)}
        >
          <Icon size={20} aria-hidden />
        </button>
      }
      {...props}
    />
  );
}

export { rowVariants };
