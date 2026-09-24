import type { ReactNode } from 'react';
import { INFO } from './theme.js';

export function Working({ label }: { label: string }): ReactNode {
  return <text fg={INFO}>{label}</text>;
}
