import * as React from 'react';
import { TableRow, TableCell } from 'booking-flash-ds';

export function StatusRows() {
  return (
    <table className="w-full text-xs text-center border-collapse border border-gray-400">
      <tbody>
        <TableRow status="vms">
          <TableCell align="left">SHA-LAX Vessel Mgmt Slot</TableCell>
          <TableCell>210</TableCell>
        </TableRow>
        <TableRow status="apFrozen">
          <TableCell align="left">AP Frozen Booking</TableCell>
          <TableCell>44</TableCell>
        </TableRow>
        <TableRow status="apOnly">
          <TableCell align="left">AP Only Booking</TableCell>
          <TableCell>12</TableCell>
        </TableRow>
        <TableRow status="noCall">
          <TableCell align="left">NO N.A. CALL</TableCell>
          <TableCell>3</TableCell>
        </TableRow>
        <TableRow total>
          <TableCell align="left" bold>
            Grand Total
          </TableCell>
          <TableCell bold>269</TableCell>
        </TableRow>
      </tbody>
    </table>
  );
}
