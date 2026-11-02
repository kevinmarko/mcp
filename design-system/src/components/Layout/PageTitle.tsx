import React from 'react';

export interface PageTitleProps {
  children: React.ReactNode;
  className?: string;
}

/** PageTitle is the app's large italic pink title style, e.g. "Booking Flash Report NA". */
export function PageTitle({ children, className = '' }: PageTitleProps) {
  return (
    <h1
      className={['text-3xl font-extrabold italic tracking-tighter', className].join(' ')}
      style={{ fontFamily: 'Arial, sans-serif' }}
    >
      {children}
    </h1>
  );
}
