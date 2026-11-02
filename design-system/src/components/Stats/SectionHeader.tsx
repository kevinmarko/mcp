import React from 'react';

export interface SectionHeaderProps {
  /** A single emoji glyph used as the section icon (the report uses no icon library). */
  icon: string;
  title: string;
  subtitle?: string;
  className?: string;
}

/** SectionHeader is the icon + title + subtitle block that opens a page section, e.g. "Sector Summary". */
export function SectionHeader({ icon, title, subtitle, className = '' }: SectionHeaderProps) {
  return (
    <div className={['flex items-center gap-2', className].join(' ')}>
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="text-lg font-extrabold text-brand leading-tight">{title}</div>
        {subtitle ? <div className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</div> : null}
      </div>
    </div>
  );
}
