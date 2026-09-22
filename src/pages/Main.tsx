import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';
import { Plate } from '../components/Plate.js';
import { WalletInfo } from '../components/WalletInfo.js';

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
      <Plate wallet={activeWallet} />
      <WalletInfo wallet={activeWallet} network={network} refreshToken={refreshToken} />
    </Box>
  );
}
