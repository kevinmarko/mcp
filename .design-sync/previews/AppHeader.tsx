import * as React from 'react';
import { AppHeader, Button } from 'booking-flash-ds';

export function Default() {
  return (
    <AppHeader
      title="Booking Flash Report NA"
      actions={
        <>
          <span className="text-xs text-gray-500 mb-1">Last Refresh: 2026-08-28 06:15 AM</span>
          <Button variant="outline" size="sm">
            Refresh Now
          </Button>
        </>
      }
    />
  );
}
