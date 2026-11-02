import React from 'react';

export interface FilterBarProps {
  /** SlicerGroup / SearchableSlicerGroup elements. */
  children: React.ReactNode;
  onClear?: () => void;
  className?: string;
}

/**
 * FilterBar is the outer bordered panel that holds every slicer group in
 * the report, plus a right-aligned Clear Filters action.
 */
export function FilterBar({ children, onClear, className = '' }: FilterBarProps) {
  return (
    <div
      className={[
        'flex-1 bg-table-panel dark:bg-gray-800 border-2 border-black dark:border-gray-600 p-2 flex flex-col gap-2 shadow-sm rounded-sm',
        className,
      ].join(' ')}
    >
      {children}
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto self-start mt-1.5 bg-gray-700 text-white px-1.5 py-0.5 text-[12px] font-bold rounded-sm hover:bg-gray-900"
        >
          Clear Filters
        </button>
      ) : null}
    </div>
  );
}
