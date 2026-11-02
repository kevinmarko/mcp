import * as React from 'react';
import { AlertBanner, Button } from 'booking-flash-ds';

export function Error() {
  return <AlertBanner tone="error">Failed to parse the uploaded workbook — check the file and try again.</AlertBanner>;
}

export function Warning() {
  return <AlertBanner tone="warning">Auto-fetch from the source sheet failed; showing the last successful data pull.</AlertBanner>;
}

export function InfoWithAction() {
  return (
    <AlertBanner
      tone="info"
      action={
        <Button variant="info" size="sm">
          Refresh
        </Button>
      }
    >
      New data is available for Sale Week 35.
    </AlertBanner>
  );
}
