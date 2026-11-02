import React from 'react';

export interface StepperButtonProps {
  direction: 'inc' | 'dec';
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
}

/** +/- stepper button, e.g. for the report's zoom control. */
export function StepperButton({ direction, onClick, ariaLabel, className = '' }: StepperButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? (direction === 'inc' ? 'Increase' : 'Decrease')}
      onClick={onClick}
      className={[
        'px-2 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 border-2 border-black dark:border-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600 font-bold',
        className,
      ].join(' ')}
    >
      {direction === 'inc' ? '+' : '−'}
    </button>
  );
}
