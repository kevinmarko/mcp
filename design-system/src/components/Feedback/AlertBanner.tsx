import React from 'react';

export type AlertBannerTone = 'error' | 'warning' | 'info';

const TONE_CLASSES: Record<AlertBannerTone, string> = {
  error: 'bg-red-100 dark:bg-red-950 border-red-500 dark:border-red-700 text-red-800 dark:text-red-300 font-bold px-4 py-3',
  warning: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-400 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300 font-semibold px-4 py-2 text-sm',
  info: 'bg-blue-50 dark:bg-blue-950 border-blue-400 dark:border-blue-700 text-blue-900 dark:text-blue-200 font-semibold px-4 py-2 text-sm',
};

const ROLE_BY_TONE: Record<AlertBannerTone, 'alert' | 'status'> = {
  error: 'alert',
  warning: 'alert',
  info: 'status',
};

export interface AlertBannerProps {
  tone: AlertBannerTone;
  children: React.ReactNode;
  /** Optional trailing action, e.g. a "Refresh" button on the info banner. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * AlertBanner is the report's full-width status strip — used for parse
 * errors, auto-fetch warnings, and "new data available" prompts.
 */
export function AlertBanner({ tone, children, action, className = '' }: AlertBannerProps) {
  return (
    <div role={ROLE_BY_TONE[tone]} className={['border-2 rounded mb-4 shadow-sm flex items-center justify-between gap-3', TONE_CLASSES[tone], className].join(' ')}>
      <span>{children}</span>
      {action}
    </div>
  );
}
