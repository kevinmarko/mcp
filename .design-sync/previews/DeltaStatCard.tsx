import * as React from 'react';
import { DeltaStatCard } from 'booking-flash-ds';

export function CompareGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-xl">
      <DeltaStatCard label="Total Bookings" oldValue={4210} newValue={4385} />
      <DeltaStatCard label="AP Frozen" oldValue={112} newValue={98} />
      <DeltaStatCard label="Laden (TEU)" oldValue={16105} newValue={16105} />
      <DeltaStatCard label="Shortfall" oldValue={-1800} newValue={-2315} />
    </div>
  );
}
