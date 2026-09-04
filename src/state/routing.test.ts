import { initialRoute, routeAfterNetworkSwitch } from './routing.js';

describe('initialRoute', () => {
  it('opens the provider gate before anything else when the network is unconfigured', () => {
    expect(initialRoute({ providerConfigured: false, hasWallet: false })).toBe('providerSetup');
    // Even with a wallet: a dashboard with no chain access shows nothing useful.
    expect(initialRoute({ providerConfigured: false, hasWallet: true })).toBe('providerSetup');
  });

  it('opens the dashboard when a wallet and a provider are ready', () => {
    expect(initialRoute({ providerConfigured: true, hasWallet: true })).toBe('main');
  });

  it('opens onboarding when the provider is ready but there is no wallet', () => {
    expect(initialRoute({ providerConfigured: true, hasWallet: false })).toBe('onboarding');
  });
});

describe('routeAfterNetworkSwitch', () => {
  it('sends the user to setup when the newly selected network has no key (decision 4.9)', () => {
    expect(routeAfterNetworkSwitch({ providerConfigured: false, hasWallet: true })).toBe(
      'providerSetup',
    );
  });

  it('returns to the dashboard when the new network is already configured', () => {
    expect(routeAfterNetworkSwitch({ providerConfigured: true, hasWallet: true })).toBe('main');
  });
});
