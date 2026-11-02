import * as React from 'react';
import { IconCloseButton } from 'booking-flash-ds';

export function Boxed() {
  return (
    <div className="p-2 bg-white border border-black inline-block">
      <IconCloseButton variant="boxed" onClick={() => {}} />
    </div>
  );
}

export function Plain() {
  return (
    <div className="p-3 bg-[#c2185b] inline-block">
      <IconCloseButton variant="plain" onClick={() => {}} />
    </div>
  );
}
