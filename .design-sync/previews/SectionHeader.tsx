import * as React from 'react';
import { SectionHeader } from 'booking-flash-ds';

export function SectorSummary() {
  return <SectionHeader icon="🌐" title="Sector Summary" subtitle="All trades, current Sale Week" />;
}

export function Analyze() {
  return <SectionHeader icon="📈" title="Analyze" subtitle="Sale Week 35 utilization snapshot" />;
}
