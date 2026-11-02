import * as React from 'react';
import { Switch } from 'booking-flash-ds';

export function DarkModeToggle() {
  const [dark, setDark] = React.useState(false);
  return <Switch checked={dark} onChange={setDark} labels={['☀️ Light', '🌙 Dark']} />;
}
