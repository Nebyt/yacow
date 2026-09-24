import type { ReactNode } from 'react';
import type { InputProps } from '@opentui/react';
import { ACCENT, FG, MUTED } from './theme.js';

/**
 * OpenTUI's `<input>` defaults its text and its cursor to a literal `#FFFFFF`,
 * both of which vanish on a light terminal theme — the cursor is drawn, just
 * white on white. Always use this instead of `<input>` directly.
 */
export function TextInput(props: InputProps): ReactNode {
  return (
    <input
      textColor={FG}
      focusedTextColor={FG}
      placeholderColor={MUTED}
      cursorColor={ACCENT}
      {...props}
    />
  );
}
