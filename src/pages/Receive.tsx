import React from 'react';
import { Box, Text } from 'ink';

/** Receive page: address + QR (plan §3 Op 4). Placeholder for M0. */
export function Receive(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Receive</Text>
      <Text color="gray">Next unused address and its QR code land here (M4).</Text>
    </Box>
  );
}
