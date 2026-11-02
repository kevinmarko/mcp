import React from 'react';

export type DiffTableVariant = 'added' | 'removed' | 'changed';

const HEAD_CLASSES: Record<DiffTableVariant, string> = {
  added: 'bg-green-100',
  removed: 'bg-red-100',
  changed: 'bg-amber-100',
};

const ROW_CLASSES: Record<DiffTableVariant, string> = {
  added: 'odd:bg-white even:bg-green-50',
  removed: 'odd:bg-white even:bg-red-50',
  changed: 'odd:bg-white even:bg-amber-50',
};

export interface DiffTableColumn {
  key: string;
  label: string;
}

export interface DiffTableProps {
  variant: DiffTableVariant;
  columns: DiffTableColumn[];
  rows: Array<Record<string, React.ReactNode>>;
  className?: string;
}

/**
 * DiffTable renders one of the three tables in the report's file-Compare
 * tab (Added / Removed / Changed bookings) — a colored header and
 * zebra-striped body, sized by severity.
 */
export function DiffTable({ variant, columns, rows, className = '' }: DiffTableProps) {
  return (
    <table className={['w-full text-xs text-left border-collapse', className].join(' ')}>
      <thead className={HEAD_CLASSES[variant]}>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className="p-1.5 font-semibold border border-gray-300">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={ROW_CLASSES[variant]}>
            {columns.map((col) => (
              <td key={col.key} className="p-1.5 border border-gray-200">
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
