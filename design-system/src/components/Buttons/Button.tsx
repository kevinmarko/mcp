import React from 'react';

export type ButtonVariant = 'primary' | 'dark' | 'outline' | 'warning' | 'info';
export type ButtonSize = 'sm' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-blue-800 shadow-[2px_2px_5px_rgba(0,0,0,0.2)]',
  dark: 'bg-action-export text-white border border-black shadow-[2px_2px_5px_rgba(0,0,0,0.2)] hover:bg-black',
  outline: 'text-brand border border-brand hover:bg-blue-50',
  warning:
    'bg-action-warningBg dark:bg-action-warningBgDark dark:text-black border border-black hover:bg-[#ffd966] dark:hover:bg-[#a67a0a]',
  info: 'bg-action-analyze text-white hover:bg-blue-800 shadow-[2px_2px_5px_rgba(0,0,0,0.2)]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  lg: 'px-6 py-3 text-lg',
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a "Loading…" label and disables the button. */
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Button is the report's toolbar/action button — used for Export, Analyze,
 * Business Rules, Refresh, and Upload actions. Five variants cover every
 * button color used across the dashboard's header and modals.
 */
export function Button({
  variant = 'primary',
  size = 'sm',
  loading = false,
  loadingLabel = 'Checking…',
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      disabled={isDisabled}
      className={[
        'font-bold rounded-md transition-colors cursor-pointer',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isDisabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}
