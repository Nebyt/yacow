import React from 'react';
import { Box, Text } from 'ink';

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
export function Footer({ hints }: FooterProps): React.ReactElement {
  return (
    <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} flexWrap="wrap">
      {hints.map((hint) => (
        <Box key={`${hint.key}:${hint.label}`} marginRight={3}>
          <Text color="cyan" bold>
            {hint.key}
          </Text>
          <Text color="gray"> {hint.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
