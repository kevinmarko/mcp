import * as React from 'react';
import { StepperButton } from 'booking-flash-ds';

export function IncDec() {
  const [zoom, setZoom] = React.useState(100);
  return (
    <div className="flex items-center gap-2">
      <StepperButton direction="dec" onClick={() => setZoom((z) => z - 10)} ariaLabel="Zoom out" />
      <span className="text-sm font-semibold w-10 text-center">{zoom}%</span>
      <StepperButton direction="inc" onClick={() => setZoom((z) => z + 10)} ariaLabel="Zoom in" />
    </div>
  );
}
