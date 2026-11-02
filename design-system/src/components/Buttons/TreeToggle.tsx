import React from 'react';

export interface TreeToggleProps {
  collapsed: boolean;
  /** `glyph` = plain-text ▶/▼ arrow; `boxed` = bordered +/− box. */
  variant?: 'glyph' | 'boxed';
  onClick: () => void;
  className?: string;
}

/** Expand/collapse toggle for a pivot-table tree row. */
export function TreeToggle({ collapsed, variant = 'glyph', onClick, className = '' }: TreeToggleProps) {
  if (variant === 'boxed') {
    return (
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onClick}
        className={[
          'mr-1 w-4 text-center border border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-700 dark:text-gray-100 shadow-sm font-bold text-[10px] hover:bg-gray-200 dark:hover:bg-gray-600',
          className,
        ].join(' ')}
      >
        {collapsed ? '+' : '−'}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onClick}
      className={['cursor-pointer select-none hover:text-blue-700 bg-transparent border-0', className].join(' ')}
    >
      {collapsed ? '▶ ' : '▼ '}
    </button>
  );
}
