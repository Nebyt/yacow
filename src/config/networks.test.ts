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

  it('keeps the Byron protocol magic, which paper-wallet addresses need', () => {
    expect(getNetwork('mainnet').byronProtocolMagic).toBe(764824073);
    expect(getNetwork('preprod').byronProtocolMagic).toBe(1);
  });

  it('validates network names', () => {
    expect(isNetworkName('mainnet')).toBe(true);
    expect(isNetworkName('preview')).toBe(false);
  });
});
