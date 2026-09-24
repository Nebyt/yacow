import { DEFAULT_NETWORK, getNetwork, isNetworkName, NETWORKS } from './networks.js';

describe('networks', () => {
  it('defaults to preprod', () => {
    expect(DEFAULT_NETWORK).toBe('preprod');
  });

  it('has the correct CSL network ids', () => {
    expect(NETWORKS.mainnet.networkId).toBe(1);
    expect(NETWORKS.preprod.networkId).toBe(0);
  });

  it('carries no backend url: chain access belongs to the provider layer (decision 4.1)', () => {
    expect('backendUrl' in getNetwork('mainnet')).toBe(false);
    expect('backendUrl' in getNetwork('preprod')).toBe(false);
  });

  it('carries no Byron protocol magic: Byron derivation is out of the project (decision 1.7)', () => {
    expect('byronProtocolMagic' in getNetwork('mainnet')).toBe(false);
    expect('byronProtocolMagic' in getNetwork('preprod')).toBe(false);
  });

  it('validates network names', () => {
    expect(isNetworkName('mainnet')).toBe(true);
    expect(isNetworkName('preview')).toBe(false);
  });
});
