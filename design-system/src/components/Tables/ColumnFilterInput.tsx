import React from 'react';

export interface ColumnFilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * ColumnFilterInput is the small text input embedded in a table header cell
 * for per-column filtering. Stops click propagation so interacting with the
 * input never triggers a header sort/toggle.
 */
export function ColumnFilterInput({ value, onChange, placeholder = 'Filter…', className = '' }: ColumnFilterInputProps) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={[
        'block w-full text-black dark:text-gray-100 font-normal text-[9px] px-1 py-0.5 border border-gray-400 dark:border-gray-600 focus:outline-none focus:border-blue-500 bg-white dark:bg-gray-900 placeholder-gray-400 dark:placeholder-gray-500 shadow-inner rounded-sm',
        className,
      ].join(' ')}
    />
  );
}
