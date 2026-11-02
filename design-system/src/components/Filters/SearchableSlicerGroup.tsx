import React from 'react';

export interface SearchableSlicerGroupProps {
  label: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** SlicerChip elements for this group — scrolls once the chip grid exceeds ~62px tall. */
  children: React.ReactNode;
  className?: string;
}

/**
 * SearchableSlicerGroup is used for long-value slicers (Sale Week, Yard) —
 * a search box that filters/auto-selects matching chips, above a
 * height-capped scrollable chip grid.
 */
export function SearchableSlicerGroup({ label, searchValue, onSearchChange, children, className = '' }: SearchableSlicerGroupProps) {
  return (
    <div className={['flex-1 min-w-[300px] rounded-sm bg-table-panel dark:bg-gray-800 p-1', className].join(' ')}>
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold w-20">{label}</span>
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="w-20 text-[11px] p-1 border border-gray-400 rounded-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex flex-wrap content-start items-start p-1 max-h-[62px] overflow-y-auto">{children}</div>
    </div>
  );
}
