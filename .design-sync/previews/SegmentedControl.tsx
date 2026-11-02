import * as React from 'react';
import { SegmentedControl } from 'booking-flash-ds';

export function TextSize() {
  const [value, setValue] = React.useState('16');
  return (
    <SegmentedControl
      value={value}
      onChange={setValue}
      options={[
        { value: '12', label: '12' },
        { value: '14', label: '14' },
        { value: '16', label: '16' },
        { value: '18', label: '18' },
        { value: '20', label: '20' },
      ]}
    />
  );
}
