import React from 'react';

export type StatTileSeverity = 'default' | 'amber' | 'negative';

const VALUE_CLASSES: Record<StatTileSeverity, string> = {
  default: 'text-gray-900 dark:text-gray-100',
  amber: 'text-amber-600 dark:text-amber-400',
  negative: 'text-red-600 dark:text-red-400',
};

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** Visual emphasis for the value — e.g. amber for a utilization %, negative for a shortfall. */
  severity?: StatTileSeverity;
  className?: string;
}

/**
 * StatTile is a single labeled metric in a KPI grid — e.g. the "Overall
 * Snapshot" tiles in the report's Analyze modal (Capacity, Laden,
 * Utilization, Shortfall).
 */
export function StatTile({ label, value, severity = 'default', className = '' }: StatTileProps) {
  return (
    <div className={['bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md p-3', className].join(' ')}>
      <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={['text-xl font-bold', VALUE_CLASSES[severity]].join(' ')}>{value}</div>
    </div>
  );
}
