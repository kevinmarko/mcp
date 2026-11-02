import * as React from 'react';
import { Modal, Button, StatTile } from 'booking-flash-ds';

export function AnalyzeOpen() {
  return (
    <Modal
      open
      onClose={() => {}}
      title="Analyze — Sale Week 35"
      icon="📈"
      footer={
        <>
          <Button variant="dark" size="sm">
            Export
          </Button>
          <Button variant="outline" size="sm">
            Close
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Capacity (TEU)" value="18,420" />
        <StatTile label="Laden (TEU)" value="16,105" />
        <StatTile label="Utilization" value="87.4%" severity="amber" />
        <StatTile label="Shortfall" value="-2,315" severity="negative" />
      </div>
    </Modal>
  );
}
