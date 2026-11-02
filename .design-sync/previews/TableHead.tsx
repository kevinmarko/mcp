import * as React from 'react';
import { TableHead, TableCell } from 'booking-flash-ds';

export function StickyHeaderRow() {
  return (
    <table className="w-full text-xs text-center border-collapse border border-gray-400">
      <TableHead>
        <tr>
          <TableCell as="th" align="left">
            Sub Trade
          </TableCell>
          <TableCell as="th">Sale Week</TableCell>
          <TableCell as="th">Bookings</TableCell>
        </tr>
      </TableHead>
      <tbody>
        <tr>
          <TableCell align="left">PNW</TableCell>
          <TableCell>35</TableCell>
          <TableCell>412</TableCell>
        </tr>
      </tbody>
    </table>
  );
}
