import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { checkPassword } from '../security/password.js';

export interface PasswordInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Show a live zxcvbn strength meter (create flow). */
  showStrength?: boolean;
  focus?: boolean;
}

export function PasswordInput({
  label = 'Password',
  value,
  onChange,
  onSubmit,
  showStrength = false,
  focus = true,
}: PasswordInputProps): React.ReactElement {
  const check = showStrength && value.length > 0 ? checkPassword(value) : null;
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{label}: </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          mask="*"
          focus={focus}
        />
      </Box>
      {check != null && (
        <Text color={check.ok ? 'green' : 'yellow'}>
          strength: {check.label}
          {check.ok ? '' : ` — ${check.suggestions[0] ?? check.warning ?? 'keep going'}`}
        </Text>
      )}
    </Box>
  );
}
