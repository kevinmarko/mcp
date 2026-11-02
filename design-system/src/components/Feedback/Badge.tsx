import React from 'react';

export type BadgeTone = 'amber' | 'gray' | 'red' | 'green';

const TONE_CLASSES: Record<BadgeTone, string> = {
  amber: 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200',
  gray: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  red: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  green: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
};

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  /** Positions the badge absolutely in the top-right corner of a `position: relative` parent. */
  floating?: boolean;
  className?: string;
}

/** A small rounded status pill — the report's only true `rounded-full` element, used on KPI breakdown cards. */
export function Badge({ children, tone = 'gray', floating = false, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'text-[10px] font-bold px-2 py-0.5 rounded-full',
        TONE_CLASSES[tone],
        floating ? 'absolute top-2 right-2' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
