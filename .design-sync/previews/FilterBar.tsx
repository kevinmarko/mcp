import * as React from 'react';
import { FilterBar, SlicerGroup, SlicerChip } from 'booking-flash-ds';

export function Composed() {
  return (
    <FilterBar onClear={() => {}}>
      <SlicerGroup label="Sub Trade">
        <SlicerChip color="subTrade" selected>
          PNW
        </SlicerChip>
        <SlicerChip color="subTrade">SCAL</SlicerChip>
      </SlicerGroup>
      <SlicerGroup label="Coast">
        <SlicerChip color="coast" selected>
          West Coast
        </SlicerChip>
        <SlicerChip color="coast">East Coast</SlicerChip>
      </SlicerGroup>
    </FilterBar>
  );
}
