import type { ReactNode } from 'react';
import { PasswordInput } from './PasswordInput.js';
import { FG, MUTED } from './theme.js';

export interface ProviderCredentialFieldProps {
  prompt: ReactNode;
  hint: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
}

/** Shared masked provider-key form used by setup and settings. */
export function ProviderCredentialField({
  prompt,
  hint,
  value,
  onChange,
  onSubmit,
}: ProviderCredentialFieldProps): ReactNode {
  return (
    <box flexDirection="column">
      <text fg={FG}>{prompt}</text>
      <PasswordInput label="Key" value={value} onChange={onChange} onSubmit={onSubmit} />
      <text fg={MUTED}>{hint}</text>
    </box>
  );
}
