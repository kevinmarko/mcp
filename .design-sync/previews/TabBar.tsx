import * as React from 'react';
import { TabBar } from 'booking-flash-ds';

export function Default() {
  const [active, setActive] = React.useState('pol');
  return (
    <TabBar
      activeKey={active}
      onChange={setActive}
      tabs={[
        { key: 'trade', label: 'Trade Summary' },
        { key: 'sector', label: 'Sector Summary' },
        { key: 'pol', label: 'POL Booking Flash' },
        { key: 'detail', label: 'Booking Flash' },
        { key: 'compare', label: 'Compare' },
      ]}
    />
  );
}
