import React from 'react';

export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * A row of discrete, mutually-exclusive options (e.g. the report's text-size
 * picker: 12/14/16/18/20/22/24). The selected option is pink-filled.
 */
export function SegmentedControl({ options, value, onChange, className = '' }: SegmentedControlProps) {
  return (
    <div className={['flex', className].join(' ')} role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={[
            'px-2 py-1 border-2 border-black dark:border-gray-500 font-semibold',
            opt.value === value
              ? 'bg-brand text-white'
              : 'bg-gray-200 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
