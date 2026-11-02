import * as React from 'react';
import { SlicerGroup, SlicerChip } from 'booking-flash-ds';

export function SubTradeRow() {
  return (
    <SlicerGroup label="Sub Trade">
      <SlicerChip color="subTrade" selected>
        PNW
      </SlicerChip>
      <SlicerChip color="subTrade">SCAL</SlicerChip>
      <SlicerChip color="subTrade">GULF</SlicerChip>
    </SlicerGroup>
  );
}
