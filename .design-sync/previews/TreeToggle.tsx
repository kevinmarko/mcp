import * as React from 'react';
import { TreeToggle } from 'booking-flash-ds';

export function Glyph() {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div className="text-sm">
      <TreeToggle variant="glyph" collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      Asia – North America West Coast
    </div>
  );
}

export function Boxed() {
  const [collapsed, setCollapsed] = React.useState(true);
  return (
    <div className="text-sm flex items-center">
      <TreeToggle variant="boxed" collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      PNW Sub Trade
    </div>
  );
}
