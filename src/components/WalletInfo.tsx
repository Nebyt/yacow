import type { ReactNode } from 'react';
import type { ActiveWallet } from '../state/store.js';
import type { NetworkName } from '../config/networks.js';
import { Balance } from './Balance.js';
import { Delegation } from './Delegation.js';
import { getProvider } from '../net/provider/registry.js';
import { MUTED } from './theme.js';

export interface WalletInfoProps {
  wallet: ActiveWallet;
  network: NetworkName;
  /** Bumped by the R shortcut to force a re-fetch. */
  refreshToken?: number;
}

export function WalletInfo({ wallet, network, refreshToken = 0 }: WalletInfoProps): ReactNode {
  const chain = getProvider(network);
  return (
    <box marginTop={1} flexDirection="column">
      <Balance wallet={wallet} network={network} refreshToken={refreshToken} provider={chain} />
      <Delegation wallet={wallet} network={network} refreshToken={refreshToken} provider={chain} />
      <box marginTop={1}>
        <text fg={MUTED}>Recent transactions land here (M3).</text>
      </box>
    </box>
  );
}
