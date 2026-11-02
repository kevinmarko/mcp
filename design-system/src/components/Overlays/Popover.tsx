import React, { useState } from 'react';
import { IconCloseButton } from '../Buttons/IconCloseButton';

export interface PopoverProps {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
  /** Widens the panel and caps its height for longer content (e.g. Business Rules text). */
  wide?: boolean;
  /** Renders the panel open on first mount — useful for previewing the open state. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Popover is a click-to-toggle, anchored panel — used for the report's
 * Display Settings and Business Rules controls in the header.
 */
export function Popover({ trigger, title, children, wide = false, defaultOpen = false, className = '' }: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative inline-block">
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open ? (
        <div
          className={[
            'absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 dark:text-gray-100 border-2 border-black dark:border-gray-600 shadow-lg p-3 text-left z-20 flex flex-col gap-2',
            wide ? 'w-[min(480px,calc(100vw-2rem))] max-h-[420px] overflow-y-auto text-xs font-normal' : 'whitespace-nowrap',
            className,
          ].join(' ')}
        >
          <div className="flex justify-between items-center gap-4">
            <span className="font-bold text-sm">{title}</span>
            <IconCloseButton variant="boxed" onClick={() => setOpen(false)} />
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}
