import * as React from 'react';
import { TableCell } from 'booking-flash-ds';

export function Tints() {
  return (
    <table className="border-collapse">
      <tbody>
        <tr>
          <TableCell tint="currentLaden">Current Laden</TableCell>
          <TableCell tint="inland">Inland</TableCell>
          <TableCell tint="port">Port</TableCell>
          <TableCell tint="bsa">BSA</TableCell>
          <TableCell tint="reefer">Reefer</TableCell>
        </tr>
      </tbody>
    </table>
  );
}

export function NegativeAndBold() {
  return (
    <table className="border-collapse">
      <tbody>
        <tr>
          <TableCell negative>-2,315</TableCell>
          <TableCell bold>16,105</TableCell>
        </tr>
      </tbody>
    </table>
  );
}
