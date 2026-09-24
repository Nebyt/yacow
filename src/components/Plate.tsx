import React from 'react';
import { Box, Text } from 'ink';
import type { ActiveWallet } from '../state/store.js';

/** Wallet identity line: name + CIP4 plate label + the network it's viewed on. */
export function Plate({ wallet }: { wallet: ActiveWallet }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{wallet.name}</Text>
        <Text> · </Text>
        <Text color="cyan" bold>
          {wallet.plate.textPart}
        </Text>
      </Box>
    </Box>
  );
}
