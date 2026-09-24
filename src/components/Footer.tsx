import type { ReactNode } from 'react';
import { BORDER, INFO, MUTED } from './theme.js';

export interface Hint {
  key: string;
  label: string;
}

export interface FooterProps {
  hints: Hint[];
}

/**
 * Bottom shortcut hint bar (mirrors Claude Code's hint line).
 * Each hint is its own box so a key never detaches from its label, and the row
 * wraps cleanly inside the border on narrow terminals.
 */
export function Footer({ hints }: FooterProps): ReactNode {
  return (
    <box
      border
      borderStyle="single"
      borderColor={BORDER}
      paddingX={1}
      flexDirection="row"
      flexWrap="wrap"
    >
      {hints.map((hint) => (
        <box key={`${hint.key}:${hint.label}`} marginRight={3} flexDirection="row">
          <text fg={INFO}>
            <strong>{hint.key}</strong>
            <span fg={MUTED}> {hint.label}</span>
          </text>
        </box>
      ))}
    </box>
  );
}
