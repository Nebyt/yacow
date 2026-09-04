import React from 'react';
import { Box, Text } from 'ink';
import type { NetworkName } from '../config/networks.js';
import type { ActiveWallet } from '../state/store.js';

/** Wallet identity line: name + CIP4 plate label + the network it's viewed on. */
export function Plate({
  wallet,
  network,
}: {
  wallet: ActiveWallet;
  network: NetworkName;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{wallet.name}</Text>
        <Text> · </Text>
        <Text color="cyan" bold>
          {wallet.plate.textPart}
        </Text>
      </Box>
      <Text color="gray">{network}</Text>
    </Box>
  );
}
