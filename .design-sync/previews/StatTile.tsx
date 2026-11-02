import * as React from 'react';
import { StatTile } from 'booking-flash-ds';

export function Grid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-xl">
      <StatTile label="Capacity (TEU)" value="18,420" />
      <StatTile label="Laden (TEU)" value="16,105" />
      <StatTile label="Utilization" value="87.4%" severity="amber" />
      <StatTile label="Shortfall" value="-2,315" severity="negative" />
    </div>
  );
}
