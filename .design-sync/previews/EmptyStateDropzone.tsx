import * as React from 'react';
import { EmptyStateDropzone, Button } from 'booking-flash-ds';

export function Idle() {
  return (
    <EmptyStateDropzone
      title="Booking Flash Report NA"
      message="Drag and drop the source workbook here, or upload it manually to get started."
      actions={<Button variant="primary">Upload File</Button>}
    />
  );
}

export function DraggingOver() {
  return (
    <EmptyStateDropzone
      title="Booking Flash Report NA"
      message="Drop the file to load it."
      isDragging
      actions={<Button variant="primary">Upload File</Button>}
    />
  );
}
