import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
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

function servedByLabel(provider: ChainProvider): string | null {
  const fallback = provider as Partial<FallbackProvider>;
  const served = fallback.id;

  if (served == null) return null;

  const via = PROVIDER_LABELS[served];

  return fallback.primaryCoolingDown === true
    ? `${via} — primary unavailable`
    : via;
}

function Header({ network }: { network: NetworkName }): React.ReactElement {
  const provider = getProvider(network);
  const servedBy = servedByLabel(provider);

  return (
    <Box
      justifyContent="space-between"
      borderStyle="single"
      borderColor="blue"
      paddingX={1}
    >
      <Text bold underline color="blue">
        YACOW
      </Text>
      <Text color="yellow">
        {NETWORKS[network].displayName}
        <Text color="greenBright">{servedBy != null ? ` — ${servedBy}` : 'no provider'}</Text>
      </Text>
    </Box>
  );
}

function ErrorBox({ message }: { message: string }): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Text bold color="red">{message}</Text>
    </Box>
  );
}

function InfoBox({ message }: { message: string }): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Text bold color="green">{message}</Text>
    </Box>
  );
}

function StubBox(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Text color="green"> </Text>
    </Box>
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
      hints.push({ key: 'enter', label: 'copy address' });
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
  return hints.filter((h) => h.to !== route).map(({ key, label }) => ({ key, label }));
}

function Shell(): React.ReactElement {
  const { exit } = useApp();
  const { route, setRoute, network, hasWallet, capturing, refresh, copyReceiverAddress, errorHappened, errorMessage, showInfoMessage, infoMessage } = useStore();

  const back = () => setRoute(hasWallet ? 'main' : 'onboarding');

  // Global shortcuts. Suspended (except Ctrl-C) while a text field is capturing.
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        exit();
        return;
      }
      // Esc stays active even while a text field is capturing, so the user can
      // always leave a flow (fixes being trapped in Create/Restore steps).
      // Esc leaves any flow -- except the provider gate, which has nowhere to
      // go until a provider answers.
      if (key.escape) return route === 'providerSetup' ? undefined : back();
      if (capturing) return; // otherwise suspend letter shortcuts while typing
      if (input === 'q') return exit();
      if (route === 'providerSetup') return; // no navigation out of the gate
      if (input === 'n') return setRoute('network');
      if (input === ',') return setRoute('settings');
      if (input === 'w') return setRoute('wallets');
      if (!hasWallet && route === 'onboarding') {
        if (input === 'c') return setRoute('create');
        if (input === 'r') return setRoute('restore');
      }
      if (hasWallet) {
        if (input === 'R' && route === 'main') return refresh(); // re-fetch chain data on the current page
        if (key.return && route === 'receive') return copyReceiverAddress(); // copy receive address to clipboard
        if (input === 'm') return setRoute('main');
        if (input === 's') return setRoute('send');
        if (input === 'r') return setRoute('receive');
      }
    },
    { isActive: true },
  );

  let body: React.ReactElement;
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
    <Box flexDirection="column" borderStyle="double" borderColor="gray" >
      <Header network={network} />
      {errorHappened && <ErrorBox message={errorMessage || 'An error occurred.'} />}
      {showInfoMessage && <InfoBox message={infoMessage || 'Info message.'} />}
      {!errorHappened && !showInfoMessage && <StubBox />}
      <Box marginTop={1} width="100%">
        {body}
      </Box>
      <Footer hints={hintsFor(route, hasWallet)} />
    </Box>
  );
}

export type AppProps = Omit<AppProviderProps, 'children'>;

export function App(props: AppProps): React.ReactElement {
  return (
    <AppProvider {...props}>
      <Shell />
    </AppProvider>
  );
}
