import * as React from 'react';
import { Table, TableHead, TableRow, TableCell } from 'booking-flash-ds';

export function TradeSummaryPivot() {
  return (
    <Table title="Trade Summary" accentColor="#E5007D">
      <TableHead>
        <tr>
          <TableCell as="th" align="left">
            Trade
          </TableCell>
          <TableCell as="th">Capacity</TableCell>
          <TableCell as="th">Laden</TableCell>
          <TableCell as="th">Utilization</TableCell>
        </tr>
      </TableHead>
      <tbody>
        <TableRow>
          <TableCell align="left">Asia – NA West Coast</TableCell>
          <TableCell>9,800</TableCell>
          <TableCell>8,940</TableCell>
          <TableCell>91.2%</TableCell>
        </TableRow>
        <TableRow status="apFrozen">
          <TableCell align="left">Asia – NA East Coast</TableCell>
          <TableCell>6,200</TableCell>
          <TableCell>5,127</TableCell>
          <TableCell>82.7%</TableCell>
        </TableRow>
        <TableRow total>
          <TableCell align="left" bold>
            Grand Total
          </TableCell>
          <TableCell bold>16,000</TableCell>
          <TableCell bold>14,067</TableCell>
          <TableCell bold>87.9%</TableCell>
        </TableRow>
      </tbody>
    </Table>
  );
}
