import React from 'react';
import { Box, Text } from 'ink';

/** Send flow (plan §3 Op 5). Placeholder for M0. */
export function Send(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Send</Text>
      <Text color="gray">Recipient, asset/amount, review, and submit land here (M5).</Text>
    </Box>
  );
}
