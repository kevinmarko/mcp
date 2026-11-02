import * as React from 'react';
import { SlicerChip } from 'booking-flash-ds';

export function Group() {
  return (
    <div className="flex flex-wrap gap-1 p-2 bg-[#e7e6e6]">
      <SlicerChip color="subTrade" selected>
        PNW
      </SlicerChip>
      <SlicerChip color="subTrade" faded>
        SCAL
      </SlicerChip>
      <SlicerChip color="coast" selected>
        West Coast
      </SlicerChip>
      <SlicerChip color="analyst" faded>
        J. Rivera
      </SlicerChip>
      <SlicerChip color="lane" selected width={80}>
        SHA-LAX
      </SlicerChip>
    </div>
  );
}

export function StatusChips() {
  return (
    <div className="flex flex-wrap gap-1 p-2">
      <SlicerChip color="apFrozen" selected>
        AP Frozen
      </SlicerChip>
      <SlicerChip color="apOnly" selected>
        AP Only
      </SlicerChip>
    </div>
  );
}
