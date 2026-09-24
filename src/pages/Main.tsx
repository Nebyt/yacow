import type { ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { Plate } from '../components/Plate.js';
import { WalletInfo } from '../components/WalletInfo.js';
import { NoActiveWallet } from '../components/Page.js';

/** Dashboard: wallet plate + balance + latest txs (plan §3 Op 2/3). */
export function Main(): ReactNode {
  const { activeWallet, network, refreshToken } = useStore();

  if (activeWallet == null) {
    return <NoActiveWallet title="Dashboard" />;
  }

  return (
    <box flexDirection="column">
      <Plate wallet={activeWallet} />
      <WalletInfo wallet={activeWallet} network={network} refreshToken={refreshToken} />
    </box>
  );
}
