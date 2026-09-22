import React from 'react';
import type { ActiveWallet } from '../state/store.js';
import type { NetworkName } from '../config/networks.js';
import { Box, Text } from 'ink';
import { Balance } from './Balance.js';
import { Delegation } from './Delegation.js';
import { getProvider } from '../net/provider/registry.js';

export interface WalletInfoProps {
  wallet: ActiveWallet;
  network: NetworkName;
  /** Bumped by the R shortcut to force a re-fetch. */
  refreshToken?: number;
}

export function WalletInfo({
  wallet,
  network,
  refreshToken = 0,
}: WalletInfoProps): React.ReactElement {
  const chain = getProvider(network);
  return (
    <Box marginTop={1} flexDirection="column">
      <Balance wallet={wallet} network={network} refreshToken={refreshToken} provider={chain} />
      <Delegation wallet={wallet} network={network} refreshToken={refreshToken} provider={chain} />
      <Box marginTop={1}>
        <Text color="gray">Recent transactions land here (M3).</Text>
      </Box>
    </Box>
  );
};