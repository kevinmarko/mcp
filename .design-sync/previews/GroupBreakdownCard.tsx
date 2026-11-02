import * as React from 'react';
import { GroupBreakdownCard } from 'booking-flash-ds';

export function TradeBreakdown() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
      <GroupBreakdownCard
        title="Asia – NA West Coast"
        badgeText="91.2%"
        badgeTone="amber"
        rows={[
          { label: 'Capacity (TEU)', value: '9,800' },
          { label: 'Laden (TEU)', value: '8,940' },
          { label: 'Utilization', value: '91.2%', isTotal: true },
        ]}
      />
      <GroupBreakdownCard
        title="Asia – NA East Coast"
        badgeText="82.7%"
        badgeTone="amber"
        rows={[
          { label: 'Capacity (TEU)', value: '6,200' },
          { label: 'Laden (TEU)', value: '5,127' },
          { label: 'Utilization', value: '82.7%', isTotal: true },
        ]}
      />
    </div>
  );
}
