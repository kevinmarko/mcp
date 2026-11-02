import React from 'react';

export interface TableProps {
  /** Title bar text shown above the table, e.g. a pivot table's name. */
  title?: string;
  /** Title bar background — defaults to brand pink; pivot tables in the report set this per-instance. */
  accentColor?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Table is the bordered, shadowed container used for every data table and
 * pivot table in the report — an optional colored title bar, a scrollable
 * body, and the table's own `border-collapse` grid.
 */
export function Table({ title, accentColor = '#E5007D', children, className = '' }: TableProps) {
  return (
    <div
      className={[
        'border-2 border-black dark:border-gray-600 overflow-x-auto bg-white dark:bg-gray-800 shadow-lg rounded-md mb-4',
        className,
      ].join(' ')}
    >
      {title ? (
        <h2 className="text-lg font-bold text-white py-1.5 px-2" style={{ backgroundColor: accentColor }}>
          {title}
        </h2>
      ) : null}
      <table className="w-full text-xs text-center border-collapse border border-gray-400">{children}</table>
    </div>
  );
}

export interface TableHeadProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * TableHead is the table's sticky header. The box-shadow (instead of a
 * bottom border) is a deliberate workaround for a Chromium rendering bug
 * where `position: sticky` + `border-collapse` drops the header's border.
 */
export function TableHead({ children, className = '' }: TableHeadProps) {
  return (
    <thead className={['bg-table-head text-white sticky top-0 z-10 shadow-sticky-head border-black', className].join(' ')}>
      {children}
    </thead>
  );
}

export interface TableRowProps {
  children: React.ReactNode;
  /** Row-level status coloring, mirroring the source Excel's conditional formatting. */
  status?: 'vms' | 'apFrozen' | 'apOnly' | 'noCall' | 'portExcluded';
  /** True for a pivot table's Grand Total row. */
  total?: boolean;
  className?: string;
}

const ROW_STATUS_CLASSES: Record<NonNullable<TableRowProps['status']>, string> = {
  vms: 'bg-status-vms text-black font-semibold',
  apFrozen: 'bg-status-apFrozen text-black font-bold',
  apOnly: 'bg-status-apOnly text-black font-bold',
  noCall: 'bg-status-noCall italic text-black',
  portExcluded: 'bg-status-portExcluded',
};

/**
 * TableRow applies the report's row-status coloring precedence (VMS, AP
 * Frozen, AP Only, NO N.A. CALL, Port Excluded) or the pivot Grand Total
 * row style.
 */
export function TableRow({ children, status, total = false, className = '' }: TableRowProps) {
  return (
    <tr
      className={[
        total ? 'bg-[#d9e1f2] text-black font-bold' : '',
        status ? ROW_STATUS_CLASSES[status] : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </tr>
  );
}

export interface TableCellProps {
  children?: React.ReactNode;
  /** Column-group tint, matching the source report's column-family coloring. */
  tint?: 'currentLaden' | 'total' | 'inland' | 'port' | 'bsa' | 'reefer' | 'vco';
  /** Renders the value in red — for a negative accounting/number value. */
  negative?: boolean;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  as?: 'td' | 'th';
  colSpan?: number;
  rowSpan?: number;
  title?: string;
  className?: string;
}

const TINT_CLASSES: Record<NonNullable<TableCellProps['tint']>, string> = {
  currentLaden: 'bg-table-currentLaden',
  total: 'bg-table-totalTint',
  inland: 'bg-table-inlandTint',
  port: 'bg-table-portTint',
  bsa: 'bg-table-bsaTint',
  reefer: 'bg-table-reeferFallback',
  vco: 'bg-table-vcoFallback',
};

const ALIGN_CLASSES: Record<NonNullable<TableCellProps['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/** TableCell is a single data or header cell, with tint/negative/bold variants. */
export function TableCell({
  children,
  tint,
  negative = false,
  bold = false,
  align = 'center',
  as = 'td',
  colSpan,
  rowSpan,
  title,
  className = '',
}: TableCellProps) {
  const Tag = as;
  return (
    <Tag
      colSpan={colSpan}
      rowSpan={rowSpan}
      title={title}
      className={[
        'p-1 border border-gray-400 dark:border-gray-600 leading-tight',
        ALIGN_CLASSES[align],
        tint ? TINT_CLASSES[tint] : '',
        negative ? 'text-red-600' : '',
        bold ? 'font-bold' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Tag>
  );
}
