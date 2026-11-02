import * as React from 'react';
import { EmptyStateInline, Button } from 'booking-flash-ds';

export function CompareEmpty() {
  return (
    <EmptyStateInline
      message="Upload an older data file to compare against the current booking data."
      actions={<Button variant="primary">Upload Old Data File</Button>}
    />
  );
}

export function TableEmpty() {
  return <EmptyStateInline message="No data matches the selected filters." />;
}
