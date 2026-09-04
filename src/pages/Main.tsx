import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';
import { Plate } from '../components/Plate.js';
import { Balance } from '../components/Balance.js';

/** Dashboard: wallet plate + balance + latest txs (plan §3 Op 2/3). */
export function Main(): React.ReactElement {
  const { activeWallet, network, refreshToken } = useStore();

  if (activeWallet == null) {
    return (
      <Box flexDirection="column">
        <Text bold>Dashboard</Text>
        <Text color="gray">No active wallet. Press w to choose one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Plate wallet={activeWallet} network={network} />
      <Box marginTop={1} flexDirection="column">
        <Balance wallet={activeWallet} network={network} refreshToken={refreshToken} />
        <Box marginTop={1}>
          <Text color="gray">Recent transactions land here (M3). R refresh · s send · r receive</Text>
        </Box>
      </Box>
    </Box>
  );
}
