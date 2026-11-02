import React from 'react';

export interface EmptyStateInlineProps {
  message: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * EmptyStateInline is the smaller empty-state used inline within a page
 * section (e.g. the Compare tab before a comparison file is uploaded) or as
 * a full-width table row ("No data matches the selected filters.").
 */
export function EmptyStateInline({ message, actions, className = '' }: EmptyStateInlineProps) {
  return (
    <div
      className={[
        'border-4 border-dashed border-gray-400 dark:border-gray-600 rounded-lg p-10 text-center bg-gray-50 dark:bg-gray-800',
        className,
      ].join(' ')}
    >
      <p className="text-gray-500 dark:text-gray-400 font-semibold mb-3">{message}</p>
      {actions}
    </div>
  );
}
