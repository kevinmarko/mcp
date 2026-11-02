import React from 'react';

export type SlicerChipColor =
  | 'subTrade'
  | 'coast'
  | 'analyst'
  | 'lane'
  | 'saleWeek'
  | 'yard'
  | 'apFrozen'
  | 'apOnly';

const COLOR_CLASSES: Record<SlicerChipColor, string> = {
  subTrade: 'bg-chip-subTrade dark:bg-chip-subTradeDark text-white',
  coast: 'bg-chip-coast text-white',
  analyst: 'bg-chip-analyst text-white',
  lane: 'bg-chip-lane text-white',
  saleWeek: 'bg-chip-saleWeek text-white',
  yard: 'bg-chip-yard text-white',
  apFrozen: 'bg-status-apFrozen text-white',
  apOnly: 'bg-status-apOnly text-black',
};

const WIDTH_CLASSES: Record<44 | 70 | 80, string> = {
  44: 'w-[44px] shrink-0 whitespace-nowrap',
  70: 'w-[70px] shrink-0 whitespace-nowrap',
  80: 'w-[80px] shrink-0 whitespace-nowrap',
};

export interface SlicerChipProps {
  /** Chip label. */
  children: React.ReactNode;
  /** Which slicer group this chip belongs to — drives its fixed color. */
  color: SlicerChipColor;
  /** Whether this chip is the active filter value. */
  selected?: boolean;
  /** True when a sibling chip in the same group is selected instead of this one — dims the chip without hiding it. */
  faded?: boolean;
  /** Fixed pixel width, matching the source report's column-alignment convention. */
  width?: 44 | 70 | 80;
  className?: string;
  onClick?: () => void;
}

/**
 * SlicerChip is the shared filter-toggle used for every slicer group in the
 * report (Sub Trade, Coast, SPC Analyst, Lane, Sale Week, Yard, AP Status).
 * Each `color` maps to a fixed brand color so the same field is always the
 * same color across every table and filter panel.
 */
export function SlicerChip({
  children,
  color,
  selected = false,
  faded = false,
  width,
  className = '',
  onClick,
}: SlicerChipProps) {
  const widthClass = width ? WIDTH_CLASSES[width] : '';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        'text-[11px] font-semibold m-0.5 px-1 py-0.5 border border-black transition-colors hover:brightness-110',
        COLOR_CLASSES[color],
        selected ? 'shadow-inner opacity-100' : 'shadow-md shadow-black/20',
        faded && !selected ? 'opacity-40' : 'opacity-100',
        widthClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  );
}
