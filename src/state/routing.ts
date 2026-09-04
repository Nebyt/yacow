// Where the app opens (plan §12.5).
//
// The provider gate comes first: with no way to reach the chain, a dashboard
// would show nothing and a send would fail, so setup is the only useful screen
// (decision 4.5). The check is per network (decision 4.9) -- being configured
// for preprod says nothing about mainnet.
import type { Route } from './store.js';

export interface StartupState {
  /** `isConfigured(activeNetwork)` from config/providers.ts. */
  providerConfigured: boolean;
  hasWallet: boolean;
}

export function initialRoute({ providerConfigured, hasWallet }: StartupState): Route {
  if (!providerConfigured) return 'providerSetup';
  return hasWallet ? 'main' : 'onboarding';
}

/** Where to land after the active network changed. */
export function routeAfterNetworkSwitch(state: StartupState): Route {
  return initialRoute(state);
}
