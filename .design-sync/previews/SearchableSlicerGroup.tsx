import * as React from 'react';
import { SearchableSlicerGroup, SlicerChip } from 'booking-flash-ds';

export function SaleWeekSearch() {
  const [search, setSearch] = React.useState('');
  return (
    <SearchableSlicerGroup label="Sale Week" searchValue={search} onSearchChange={setSearch}>
      <SlicerChip color="saleWeek" selected width={44}>
        33
      </SlicerChip>
      <SlicerChip color="saleWeek" width={44}>
        34
      </SlicerChip>
      <SlicerChip color="saleWeek" width={44}>
        35
      </SlicerChip>
      <SlicerChip color="saleWeek" width={44}>
        36
      </SlicerChip>
    </SearchableSlicerGroup>
  );
}
