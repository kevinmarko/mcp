import * as React from 'react';
import { ToggleColumnButton } from 'booking-flash-ds';

export function Panel() {
  const [hidden, setHidden] = React.useState({ reefer: false, eta: true, ap: false, vco: true });
  const toggle = (k: keyof typeof hidden) => setHidden((h) => ({ ...h, [k]: !h[k] }));
  return (
    <div className="grid grid-cols-2 gap-1 w-64">
      <ToggleColumnButton label="Reefer" hidden={hidden.reefer} onToggle={() => toggle('reefer')} />
      <ToggleColumnButton label="ETA" hidden={hidden.eta} onToggle={() => toggle('eta')} />
      <ToggleColumnButton label="AP Status" hidden={hidden.ap} onToggle={() => toggle('ap')} />
      <ToggleColumnButton label="VCO Analyst" hidden={hidden.vco} onToggle={() => toggle('vco')} />
    </div>
  );
}
