import React from 'react';

export interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}

/** A single tab in a TabBar — pink-filled when active, gray when not. */
export function TabButton({ label, active, onClick, className = '' }: TabButtonProps) {
  return (
    <button
      type="button"
      aria-selected={active}
      role="tab"
      onClick={onClick}
      className={[
        'px-3 py-1.5 text-sm font-bold rounded-t-md transition-colors',
        active
          ? 'bg-brand text-white'
          : 'bg-gray-300 dark:bg-gray-700 text-black dark:text-gray-100 hover:bg-gray-400 dark:hover:bg-gray-600',
        className,
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export interface TabBarProps {
  tabs: Array<{ key: string; label: string }>;
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

/** TabBar renders a row of TabButtons and manages which one is active. */
export function TabBar({ tabs, activeKey, onChange, className = '' }: TabBarProps) {
  return (
    <div role="tablist" className={['flex flex-wrap gap-2', className].join(' ')}>
      {tabs.map((tab) => (
        <TabButton key={tab.key} label={tab.label} active={tab.key === activeKey} onClick={() => onChange(tab.key)} />
      ))}
    </div>
  );
}
