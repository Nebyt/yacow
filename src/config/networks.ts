// Network definitions. Only mainnet and preprod are supported (per plan §3 Op 0).
//
// There is deliberately NO backend URL here: chain data comes from the provider
// layer (`src/net/provider/`), whose hosts belong to the adapters (decision 4.1).
// Protocol parameters likewise come from the live provider (decision 4.6);
// see `src/net/protocolParams.ts` for the offline fallback.

export type NetworkName = 'mainnet' | 'preprod';

export interface Network {
  readonly name: NetworkName;
  readonly displayName: string;
  /** CSL network id: mainnet = 1, testnets = 0. */
  readonly networkId: number;
}

export const NETWORKS: Readonly<Record<NetworkName, Network>> = Object.freeze({
  mainnet: {
    name: 'mainnet',
    displayName: 'Cardano Mainnet',
    networkId: 1,
  },
  preprod: {
    name: 'preprod',
    displayName: 'Cardano Preprod',
    networkId: 0,
  },
});

export const DEFAULT_NETWORK: NetworkName = 'preprod';

export function getNetwork(name: NetworkName): Network {
  return NETWORKS[name];
}

export function isNetworkName(value: string): value is NetworkName {
  return value === 'mainnet' || value === 'preprod';
}
