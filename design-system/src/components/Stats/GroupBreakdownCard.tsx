import React from 'react';
import { Badge, type BadgeTone } from '../Feedback/Badge';

export interface GroupBreakdownRow {
  label: string;
  value: React.ReactNode;
  /** Adds a top divider — use on the final, totals row. */
  isTotal?: boolean;
}

export interface GroupBreakdownCardProps {
  /** Card heading, e.g. a Trade or Sub Trade name. */
  title: string;
  rows: GroupBreakdownRow[];
  /** Optional floating corner badge, e.g. a utilization callout. */
  badgeText?: string;
  badgeTone?: BadgeTone;
  className?: string;
}

/**
 * GroupBreakdownCard shows a labeled group's metric rows (e.g. per-Trade
 * capacity/laden/utilization) with an optional floating status badge — used
 * in the report's Analyze modal breakdown grid.
 */
export function GroupBreakdownCard({ title, rows, badgeText, badgeTone = 'amber', className = '' }: GroupBreakdownCardProps) {
  return (
    <div className={['border border-gray-200 dark:border-gray-600 rounded-md p-3 relative', className].join(' ')}>
      {badgeText ? (
        <Badge tone={badgeTone} floating>
          {badgeText}
        </Badge>
      ) : null}
      <div className="text-sm font-bold mb-1 pr-12">{title}</div>
      {rows.map((row, i) => (
        <div
          key={i}
          className={[
            'flex justify-between text-xs',
            row.isTotal ? 'border-t border-gray-100 dark:border-gray-600 pt-1 mt-1 font-semibold' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="text-gray-500 dark:text-gray-400">{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
