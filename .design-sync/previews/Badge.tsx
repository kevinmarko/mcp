import * as React from 'react';
import { Badge } from 'booking-flash-ds';

export function Tones() {
  return (
    <div className="flex gap-2">
      <Badge tone="amber">91.2%</Badge>
      <Badge tone="gray">Draft</Badge>
      <Badge tone="red">3 Alerts</Badge>
      <Badge tone="green">On Time</Badge>
    </div>
  );
}
