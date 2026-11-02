import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Labels shown for the on/off state, e.g. ['☀️ Light', '🌙 Dark']. */
  labels?: [string, string];
  className?: string;
}

/**
 * Switch formalizes the report's dark-mode toggle as a reusable on/off
 * control — a bordered button whose label swaps with state.
 */
export function Switch({ checked, onChange, labels = ['On', 'Off'], className = '' }: SwitchProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={[
        'px-2 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 border-2 border-black dark:border-gray-500 font-bold text-xs hover:bg-gray-300 dark:hover:bg-gray-600',
        className,
      ].join(' ')}
    >
      {checked ? labels[1] : labels[0]}
    </button>
  );
}
