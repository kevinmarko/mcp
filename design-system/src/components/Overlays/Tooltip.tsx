import React, { useState } from 'react';

export interface TooltipProps {
  text: string;
  children: React.ReactNode;
  /** Renders the bubble visible on first mount — useful for previewing the hover state. */
  defaultVisible?: boolean;
  className?: string;
}

/**
 * Tooltip is a real hover tooltip in the report's visual language. The
 * source report only ever uses the browser's native `title` attribute for
 * hint text (utilization-gap flags, header notes) — this component is a new
 * addition, not an extraction, for anywhere the design agent needs a
 * visible, styleable tooltip instead.
 */
export function Tooltip({ text, children, defaultVisible = false, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(defaultVisible);
  return (
    <span
      className={['relative inline-block', className].join(' ')}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded bg-gray-900 text-white text-[11px] px-2 py-1 shadow-lg z-30"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
