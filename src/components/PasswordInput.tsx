import { useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { checkPassword } from '../security/password.js';
import { ACCENT, FG, SUCCESS, WARNING } from './theme.js';

export interface PasswordInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Show a live zxcvbn strength meter (create flow). */
  showStrength?: boolean;
  focus?: boolean;
}

/**
 * Masked field. OpenTUI `<input>` has no password mode, so we capture keys
 * ourselves and render bullets (decision 3.5: do not echo secrets).
 */
export function PasswordInput({
  label = 'Password',
  value,
  onChange,
  onSubmit,
  showStrength = false,
  focus = true,
}: PasswordInputProps): ReactNode {
  const check = showStrength && value.length > 0 ? checkPassword(value) : null;

  useKeyboard((key) => {
    if (!focus) return;
    if (key.ctrl || key.meta) return;
    if (key.name === 'escape') return;
    if (key.name === 'return') {
      key.stopPropagation();
      onSubmit?.(value);
      return;
    }
    if (key.name === 'backspace') {
      key.stopPropagation();
      onChange(value.slice(0, -1));
      return;
    }
    const ch = key.sequence;
    if (ch.length === 1 && ch >= ' ') {
      key.stopPropagation();
      onChange(value + ch);
    }
  });

  return (
    <box flexDirection="column">
      {/* This field has no real cursor to place — it is text, not an
          `<input>` — so draw the caret ourselves while it has the keys. */}
      <text fg={FG}>
        {label}: {'*'.repeat(value.length)}
        {focus && <span bg={ACCENT}> </span>}
      </text>
      {check != null && (
        <text fg={check.ok ? SUCCESS : WARNING}>
          strength: {check.label}
          {check.ok ? '' : ` — ${check.suggestions[0] ?? check.warning ?? 'keep going'}`}
        </text>
      )}
    </box>
  );
}
