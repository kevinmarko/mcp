import React from 'react';
import { OneLogo } from './OneLogo';
import { PageTitle } from './PageTitle';

export interface AppHeaderProps {
  title: string;
  /** Right-aligned slot for settings triggers, timestamps, and action buttons. */
  actions?: React.ReactNode;
  className?: string;
}

/** AppHeader composes the logo, page title, and a right-aligned actions slot into the report's main header bar. */
export function AppHeader({ title, actions, className = '' }: AppHeaderProps) {
  return (
    <div
      className={[
        'flex flex-wrap justify-between items-end gap-2 mb-2 border-b-2 border-gray-300 dark:border-gray-700 pb-1',
        className,
      ].join(' ')}
    >
      <div className="flex items-end gap-2">
        <OneLogo className="h-11 w-auto" />
        <PageTitle>{title}</PageTitle>
      </div>
      {actions ? <div className="flex items-end gap-2">{actions}</div> : null}
    </div>
  );
}
