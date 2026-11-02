import React from 'react';

export interface DeltaStatCardProps {
  label: string;
  oldValue: number;
  newValue: number;
  /** Formats a raw number for display, e.g. `(n) => n.toLocaleString()`. Defaults to toLocaleString. */
  format?: (n: number) => string;
  className?: string;
}

/**
 * DeltaStatCard compares an old vs. new value and colors the delta line
 * green/red/gray by sign — used in the report's file-Compare tab summary.
 */
export function DeltaStatCard({ label, oldValue, newValue, format = (n) => n.toLocaleString(), className = '' }: DeltaStatCardProps) {
  const delta = newValue - oldValue;
  const sign = delta > 0 ? '+' : delta < 0 ? '' : '';
  const deltaColor =
    delta > 0
      ? 'text-green-700 dark:text-green-400'
      : delta < 0
        ? 'text-red-700 dark:text-red-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      className={[
        'border border-gray-300 dark:border-gray-600 rounded-md p-3 bg-gray-50 dark:bg-gray-800',
        className,
      ].join(' ')}
    >
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">{format(oldValue)}</div>
      <div className="text-lg font-extrabold text-brand">{format(newValue)}</div>
      <div className={['text-xs font-semibold', deltaColor].join(' ')}>
        {sign}
        {format(delta)}
      </div>
    </div>
  );
}
