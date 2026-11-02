import * as React from 'react';
import { Tooltip } from 'booking-flash-ds';

export function OverText() {
  return (
    <div className="w-96 flex justify-center pt-8 pb-4">
      <Tooltip text="Utilization increased by 10% or greater since the prior business day." defaultVisible>
        <span className="underline decoration-dotted cursor-help">87.4%</span>
      </Tooltip>
    </div>
  );
}
