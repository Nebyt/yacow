import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_NETWORK, type NetworkName } from '../config/networks.js';
import type { Plate } from '../crypto/plate.js';
import { listWallets } from '../wallet/discoverWallets.js';
import clipboard from 'clipboardy';

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
  errorHappened: boolean;
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  showError: () => void;
  showInfoMessage: boolean;
  infoMessage: string | null;
  setInfoMessage: (message: string | null) => void;
  showInfo: () => void;
  /** When true, a text field owns the keyboard; global shortcuts are suspended. */
  capturing: boolean;
  setCapturing: (capturing: boolean) => void;
  /** Bumped by the R shortcut; chain-reading views re-fetch when it changes. */
  refreshToken: number;
  refresh: () => void;
  receiveAddress: string | null;
  setReceiveAddress: (address: string | null) => void;
  copyReceiverAddress: () => Promise<void>;
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
  const [errorHappened, setErrorHappened] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showInfoMessage, setShowInfoMessage] = useState<boolean>(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null);

  const showError = useCallback(() => {
    setErrorHappened(true);
    setTimeout(() => {
      setErrorHappened(false)
      setErrorMessage(null);
    }, 3000);
  }, []);

  const showInfo = useCallback(() => {
    setShowInfoMessage(true);
    setTimeout(() => {
      setShowInfoMessage(false);
      setInfoMessage(null);
    }, 3000);
  }, []);
  
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  
  const copyReceiverAddress = useCallback(async () => {
    if (receiveAddress == null) {
      return;
    }
    try {
      await clipboard.write(receiveAddress);
      setInfoMessage('Address copied to clipboard.');
      showInfo();
    } catch (error) {
      setErrorMessage('Failed to copy address to clipboard.');
      showError();
    }
  }, [receiveAddress, showError]);

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
      // Error handling
      errorHappened,
      errorMessage,
      setErrorMessage,
      showError,
      // Info handling
      showInfoMessage,
      infoMessage,
      setInfoMessage,
      showInfo,
      capturing,
      setCapturing,
      refreshToken,
      refresh,
      receiveAddress,
      setReceiveAddress,
      copyReceiverAddress,
    }),
    [
      route,
      network,
      activeWallet,
      walletList,
      hasWallet,
      capturing,
      errorHappened,
      errorMessage,
      setErrorMessage,
      showError,
      showInfoMessage,
      infoMessage,
      setInfoMessage,
      showInfo,
      setCapturing,
      refreshWalletList,
      refreshToken,
      refresh,
      receiveAddress,
      setReceiveAddress,
      copyReceiverAddress,
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
