import * as React from 'react';
import { TabButton } from 'booking-flash-ds';

export function ActiveInactive() {
  return (
    <div className="flex gap-2">
      <TabButton label="Trade Summary" active onClick={() => {}} />
      <TabButton label="Sector Summary" active={false} onClick={() => {}} />
      <TabButton label="POL Booking Flash" active={false} onClick={() => {}} />
    </div>
  );
}
