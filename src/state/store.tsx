import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_NETWORK, type NetworkName } from '../config/networks.js';
import type { Plate } from '../crypto/plate.js';
import { listWallets } from '../wallet/discoverWallets.js';

export type Route =
  | 'providerSetup'
  | 'onboarding'
  | 'wallets'
  | 'create'
  | 'restore'
  | 'main'
  | 'send'
  | 'receive'
  | 'network'
  | 'settings';

export interface ActiveWallet {
  name: string;
  accountPubKey: string;
  plate: Plate;
}

export interface AppStore {
  route: Route;
  setRoute: (route: Route) => void;
  network: NetworkName;
  setNetwork: (network: NetworkName) => void;
  activeWallet: ActiveWallet | null;
  setActiveWallet: (wallet: ActiveWallet | null) => void;
  walletList: string[];
  refreshWalletList: () => void;
  hasWallet: boolean;
  /** When true, a text field owns the keyboard; global shortcuts are suspended. */
  capturing: boolean;
  setCapturing: (capturing: boolean) => void;
  /** Bumped by the R shortcut; chain-reading views re-fetch when it changes. */
  refreshToken: number;
  refresh: () => void;
}

const AppContext = createContext<AppStore | null>(null);

export interface AppProviderProps {
  initialRoute?: Route;
  initialNetwork?: NetworkName;
  initialHasWallet?: boolean;
  initialWalletList?: string[];
  initialActiveWallet?: ActiveWallet | null;
  children: React.ReactNode;
}

export function AppProvider({
  initialRoute,
  initialNetwork = DEFAULT_NETWORK,
  initialHasWallet = false,
  initialWalletList,
  initialActiveWallet = null,
  children,
}: AppProviderProps): React.ReactElement {
  const [walletList, setWalletList] = useState<string[]>(
    initialWalletList ?? (initialHasWallet ? ['(wallet)'] : []),
  );
  const [activeWallet, setActiveWallet] = useState<ActiveWallet | null>(initialActiveWallet);
  const hasWallet = walletList.length > 0 || activeWallet != null;
  const [route, setRoute] = useState<Route>(initialRoute ?? (hasWallet ? 'main' : 'onboarding'));
  const [network, setNetwork] = useState<NetworkName>(initialNetwork);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const refreshWalletList = useCallback(() => {
    setWalletList(listWallets());
  }, []);

  const store = useMemo<AppStore>(
    () => ({
      route,
      setRoute,
      network,
      setNetwork,
      activeWallet,
      setActiveWallet,
      walletList,
      refreshWalletList,
      hasWallet,
      capturing,
      setCapturing,
      refreshToken,
      refresh,
    }),
    [
      route,
      network,
      activeWallet,
      walletList,
      hasWallet,
      capturing,
      refreshWalletList,
      refreshToken,
      refresh,
    ],
  );

  return <AppContext.Provider value={store}>{children}</AppContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(AppContext);
  if (store == null) {
    throw new Error('useStore must be used within an <AppProvider>.');
  }
  return store;
}
