import React, { useEffect } from 'react';
import { IconCloseButton } from '../Buttons/IconCloseButton';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A single emoji glyph shown before the title. */
  icon?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Modal is the report's dialog shell (used for the "Analyze" modal) — a
 * dark backdrop, a centered panel with a colored sticky header and a
 * sticky footer, and Escape-to-close.
 */
export function Modal({ open, onClose, title, icon, children, footer, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={[
          'bg-white dark:bg-gray-800 dark:text-gray-100 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto',
          className,
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-brandDark text-white px-4 py-3 rounded-t-lg flex justify-between items-center sticky top-0 z-10">
          <span className="font-bold text-lg">
            {icon ? <span aria-hidden="true">{icon} </span> : null}
            {title}
          </span>
          <IconCloseButton variant="plain" onClick={onClose} />
        </div>
        <div className="p-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-600 sticky bottom-0 bg-white dark:bg-gray-800 rounded-b-lg">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
