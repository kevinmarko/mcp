import React from 'react';

export interface IconCloseButtonProps {
  onClick: () => void;
  /** `boxed` for popover/modal-corner close buttons; `plain` for a bare × on a colored header. */
  variant?: 'boxed' | 'plain';
  ariaLabel?: string;
  className?: string;
}

/** Small × close button used on popovers, modals, and settings panels. */
export function IconCloseButton({ onClick, variant = 'boxed', ariaLabel = 'Close', className = '' }: IconCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        variant === 'boxed'
          ? 'font-bold px-1.5 border border-black dark:border-gray-500 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
          : 'text-white hover:text-gray-200 text-xl font-bold leading-none',
        className,
      ].join(' ')}
    >
      ×
    </button>
  );
}
