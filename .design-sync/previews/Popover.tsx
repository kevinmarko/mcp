import * as React from 'react';
import { Popover, Button } from 'booking-flash-ds';

export function DisplaySettingsOpen() {
  return (
    <div className="flex justify-end pt-2 w-full max-w-md">
      <Popover trigger={<Button size="sm">⚙️ Display Settings</Button>} title="Display Settings" defaultOpen>
        <div className="text-xs">Zoom, text size, and dark mode controls.</div>
      </Popover>
    </div>
  );
}

export function BusinessRulesWide() {
  return (
    <div className="flex justify-end pt-2 w-full max-w-2xl">
      <Popover trigger={<Button variant="warning" size="sm">ℹ️ Business Rules</Button>} title="Business Rules" wide defaultOpen>
        <ul className="list-disc pl-4 space-y-1.5 text-xs">
          <li>A booking is flagged AP Frozen once its AP cutoff has passed.</li>
          <li>NO N.A. CALL rows are excluded from utilization totals.</li>
        </ul>
      </Popover>
    </div>
  );
}
