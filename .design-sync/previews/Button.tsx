import * as React from 'react';
import { Button } from 'booking-flash-ds';

export function Variants() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary">Analyze</Button>
      <Button variant="dark">Export</Button>
      <Button variant="outline">Refresh Now</Button>
      <Button variant="warning">Business Rules</Button>
      <Button variant="info">View Details</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm">Refresh Now</Button>
      <Button size="lg">Upload File</Button>
    </div>
  );
}

export function DisabledAndLoading() {
  return (
    <div className="flex gap-2">
      <Button variant="primary" disabled>
        Analyze
      </Button>
      <Button variant="outline" loading loadingLabel="Checking…">
        Refresh Now
      </Button>
    </div>
  );
}
