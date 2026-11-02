import * as React from 'react';
import { DiffTable } from 'booking-flash-ds';

const columns = [
  { key: 'booking', label: 'Booking #' },
  { key: 'lane', label: 'Lane' },
  { key: 'teu', label: 'TEU' },
];

export function Added() {
  return (
    <DiffTable
      variant="added"
      columns={columns}
      rows={[
        { booking: 'BKG-88213', lane: 'SHA-LAX', teu: 40 },
        { booking: 'BKG-88214', lane: 'NGB-OAK', teu: 20 },
      ]}
    />
  );
}

export function Removed() {
  return (
    <DiffTable
      variant="removed"
      columns={columns}
      rows={[{ booking: 'BKG-87990', lane: 'YTN-LAX', teu: 40 }]}
    />
  );
}

export function Changed() {
  return (
    <DiffTable
      variant="changed"
      columns={[...columns, { key: 'diff', label: 'Changes' }]}
      rows={[
        {
          booking: 'BKG-88100',
          lane: 'SHA-LAX',
          teu: 40,
          diff: (
            <span>
              <span className="font-bold">Status:</span> Open → AP Frozen
            </span>
          ),
        },
      ]}
    />
  );
}
