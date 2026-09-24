import { useRenderer, useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { AppProvider, useStore, type AppProviderProps } from './state/store.js';
import { NETWORKS, type NetworkName } from './config/networks.js';
import { Footer, type Hint } from './components/Footer.js';
import { Onboarding } from './pages/Onboarding.js';
import { Wallets } from './pages/Wallets.js';
import { CreateWallet } from './pages/CreateWallet.js';
import { RestoreWallet } from './pages/RestoreWallet.js';
import { Main } from './pages/Main.js';
import { Send } from './pages/Send.js';
import { Receive } from './pages/Receive.js';
import { Network } from './pages/Network.js';
import { ProviderSetup } from './pages/ProviderSetup.js';
import { Settings } from './pages/Settings.js';
import { ChainProvider, PROVIDER_LABELS } from './net/provider/types.js';
import { FallbackProvider } from './net/provider/fallback.js';
import { getProvider } from './net/provider/registry.js';
import { ACCENT, BORDER, ERROR, SUCCESS, WARNING } from './components/theme.js';

function servedByLabel(provider: ChainProvider): string | null {
  const fallback = provider as Partial<FallbackProvider>;
  const served = fallback.id;

  if (served == null) return null;

  const via = PROVIDER_LABELS[served];

  return fallback.primaryCoolingDown === true ? `${via} — primary unavailable` : via;
}

function Header({ network }: { network: NetworkName }): ReactNode {
  const provider = getProvider(network);
  const servedBy = servedByLabel(provider);

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      border
      borderStyle="single"
      borderColor={ACCENT}
      paddingX={1}
    >
      <text fg={ACCENT}>
        <strong>
          <u>YACOW</u>
        </strong>
      </text>
      <text fg={WARNING}>
        {NETWORKS[network].displayName}
        <span fg={SUCCESS}>{servedBy != null ? ` — ${servedBy}` : 'no provider'}</span>
      </text>
    </box>
  );
}

function ErrorBox({ message }: { message: string }): ReactNode {
  return (
    <box justifyContent="center" alignItems="center">
      <text fg={ERROR}>
        <strong>{message}</strong>
      </text>
    </box>
  );
}

function InfoBox({ message }: { message: string }): ReactNode {
  return (
    <box justifyContent="center" alignItems="center">
      <text fg={SUCCESS}>
        <strong>{message}</strong>
      </text>
    </box>
  );
}

function hintsFor(route: string, hasWallet: boolean): Hint[] {
  // The provider gate is a gate: every other destination needs chain access,
  // so the only way out is finishing setup (or quitting). Decision 4.5.
  if (route === 'providerSetup') {
    return [{ key: 'q', label: 'quit' }];
  }
  // During wallet creation/restore, only offer back/quit — other shortcuts
  // would abandon the flow (and the just-generated phrase). (backlog #6)
  if (route === 'create' || route === 'restore') {
    return [
      { key: 'esc', label: 'back' },
      { key: 'q', label: 'quit' },
    ];
  }
  // Onboarding has its own fixed set (no wallet-nav hints — showing them here
  // would collide on the 'r' key with "restore" and duplicate React keys).
  if (route === 'onboarding') {
    return [
      { key: 'c', label: 'create' },
      { key: 'r', label: 'restore' },
      { key: 'w', label: 'wallets' },
      { key: 'n', label: 'network' },
      { key: ',', label: 'settings' },
      { key: 'q', label: 'quit' },
    ];
  }
  // Nav hints carry their target route so we can drop the shortcut that points
  // at the page we're already on (e.g. no "m main" on the dashboard).
  type NavHint = Hint & { to?: string };
  const hints: NavHint[] = [];
  if (hasWallet) {
    if (route === 'main') {
      hints.push({ key: 'R', label: 'refresh' });
    }
    if (route === 'receive') {
      hints.push({ key: 'Enter', label: 'copy address' });
    }
    hints.push(
      { key: 'm', label: 'main', to: 'main' },
      { key: 's', label: 'send', to: 'send' },
      { key: 'r', label: 'receive', to: 'receive' },
    );
  }
  hints.push(
    { key: 'w', label: 'wallets', to: 'wallets' },
    { key: 'n', label: 'network', to: 'network' },
    // ',' because every letter that fits is already taken (s/n/w/r/m/c/q).
    { key: ',', label: 'settings', to: 'settings' },
  );
  if (route !== 'main') {
    hints.push({ key: 'esc', label: 'back' });
  }
  hints.push({ key: 'q', label: 'quit' });
  // Drop any hints that point to the current route (e.g. no "m main" on the dashboard).
  return hints.filter((h) => h.to !== route).map(({ key, label }) => ({ key, label }));
}

function Shell(): ReactNode {
  const renderer = useRenderer();
  const {
    route,
    setRoute,
    network,
    hasWallet,
    capturing,
    refresh,
    copyReceiverAddress,
    errorHappened,
    errorMessage,
    showInfoMessage,
    infoMessage,
  } = useStore();

  const back = () => setRoute(hasWallet ? 'main' : 'onboarding');

  // Global shortcuts. Direct listeners run before the focused field (OpenTUI).
  // Suspended (except Esc / q) while a text field is capturing.
  useKeyboard((key) => {
    if (key.repeated) return;
    // Esc stays active even while a text field is capturing, so the user can
    // always leave a flow (fixes being trapped in Create/Restore steps).
    if (key.name === 'escape') {
      if (route === 'providerSetup') return;
      key.stopPropagation();
      back();
      return;
    }
    if (capturing) return;
    if (key.name === 'q') {
      key.stopPropagation();
      renderer.destroy();
      return;
    }
    if (route === 'providerSetup') return; // no navigation out of the gate
    if (key.name === 'n') {
      key.stopPropagation();
      setRoute('network');
      return;
    }
    if (key.name === ',') {
      key.stopPropagation();
      setRoute('settings');
      return;
    }
    if (key.name === 'w') {
      key.stopPropagation();
      setRoute('wallets');
      return;
    }
    if (!hasWallet && route === 'onboarding') {
      if (key.name === 'c') {
        key.stopPropagation();
        setRoute('create');
        return;
      }
      if (key.name === 'r') {
        key.stopPropagation();
        setRoute('restore');
        return;
      }
    }
    if (hasWallet) {
      if (key.shift && key.name === 'r' && route === 'main') {
        key.stopPropagation();
        refresh();
        return;
      }
      if (key.name === 'return' && route === 'receive') {
        key.stopPropagation();
        void copyReceiverAddress();
        return;
      }
      if (key.name === 'm') {
        key.stopPropagation();
        setRoute('main');
        return;
      }
      if (key.name === 's') {
        key.stopPropagation();
        setRoute('send');
        return;
      }
      if (key.name === 'r' && !key.shift) {
        key.stopPropagation();
        setRoute('receive');
        return;
      }
    }
  });

  let body: ReactNode;
  switch (route) {
    case 'providerSetup':
      body = <ProviderSetup />;
      break;
    case 'create':
      body = <CreateWallet />;
      break;
    case 'restore':
      body = <RestoreWallet />;
      break;
    case 'wallets':
      body = <Wallets />;
      break;
    case 'network':
      body = <Network />;
      break;
    case 'settings':
      body = <Settings />;
      break;
    case 'send':
      body = <Send />;
      break;
    case 'receive':
      body = <Receive />;
      break;
    case 'main':
      body = <Main />;
      break;
    case 'onboarding':
    default:
      body = <Onboarding />;
      break;
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      border
      borderStyle="double"
      borderColor={BORDER}
    >
      <Header network={network} />
      {errorHappened && <ErrorBox message={errorMessage || 'An error occurred.'} />}
      {showInfoMessage && <InfoBox message={infoMessage || 'Info message.'} />}
      <box
        flexGrow={1}
        width="100%"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={!errorHappened && !showInfoMessage ? 1 : 0}
      >
        {body}
      </box>
      <Footer hints={hintsFor(route, hasWallet)} />
    </box>
  );
}

export type AppProps = Omit<AppProviderProps, 'children'>;

export function App(props: AppProps): ReactNode {
  return (
    <AppProvider {...props}>
      <Shell />
    </AppProvider>
  );
}
