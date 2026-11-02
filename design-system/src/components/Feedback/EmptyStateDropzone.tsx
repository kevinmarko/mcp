import React from 'react';

export interface EmptyStateDropzoneProps {
  title: string;
  message: React.ReactNode;
  actions?: React.ReactNode;
  isDragging?: boolean;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  className?: string;
}

/**
 * EmptyStateDropzone is the full-height initial state before data is
 * loaded — a large dashed drop target with brand messaging and upload
 * actions.
 */
export function EmptyStateDropzone({
  title,
  message,
  actions,
  isDragging = false,
  onDrop,
  onDragOver,
  onDragLeave,
  className = '',
}: EmptyStateDropzoneProps) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={[
        'flex flex-col items-center justify-center h-[80vh] border-4 border-dashed rounded-lg shadow-sm p-10 text-center m-4 transition-colors',
        isDragging ? 'border-blue-600 bg-blue-50 dark:bg-blue-950' : 'border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800',
        className,
      ].join(' ')}
    >
      <h1 className="text-4xl font-extrabold italic tracking-tighter text-brand mb-4">{title}</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-4">{message}</p>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
