import * as React from 'react';
import { ColumnFilterInput } from 'booking-flash-ds';

export function InHeader() {
  const [value, setValue] = React.useState('');
  return (
    <div className="bg-[#333333] p-2 w-40">
      <div className="text-white text-xs font-semibold mb-1">Lane</div>
      <ColumnFilterInput value={value} onChange={setValue} placeholder="Filter Lane…" />
    </div>
  );
}
