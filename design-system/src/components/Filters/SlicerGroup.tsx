import React from 'react';

export interface SlicerGroupProps {
  /** Field name label, e.g. "Sub Trade". */
  label: string;
  /** SlicerChip elements for this group. */
  children: React.ReactNode;
  className?: string;
}

/** SlicerGroup pairs a field-name label with a wrapped row of its filter chips. */
export function SlicerGroup({ label, children, className = '' }: SlicerGroupProps) {
  return (
    <div className={['flex items-start', className].join(' ')}>
      <span className="text-sm font-bold mr-2 w-20 mt-1">{label}</span>
      <div className="flex flex-wrap p-1">{children}</div>
    </div>
  );
}
