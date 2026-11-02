import React from 'react';

export interface ToggleColumnButtonProps {
  /** Base label — shown as "Show {label}" when hidden, "Hide {label}" when visible. */
  label: string;
  /** Whether the column group is currently hidden. */
  hidden: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * ToggleColumnButton toggles the visibility of a table's column group (e.g.
 * "Reefer", "ETA", "AP Status"). Used in a 2-column grid of these to build a
 * column-visibility control panel next to a data table.
 */
export function ToggleColumnButton({ label, hidden, onToggle, className = '' }: ToggleColumnButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={!hidden}
      onClick={onToggle}
      className={[
        'border border-black p-0.5 h-full flex items-center justify-center hover:brightness-105 text-[12px] leading-tight transition-all',
        hidden ? 'bg-status-vms' : 'bg-chip-subTrade dark:bg-chip-subTradeDark dark:text-gray-400',
        className,
      ].join(' ')}
    >
      {hidden ? `Show ${label}` : `Hide ${label}`}
    </button>
  );
}
