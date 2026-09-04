import {
  CACHE_TTL_MS,
  FALLBACK_PROTOCOL_PARAMS,
  clearProtocolParamsCache,
  fetchProtocolParams,
} from './protocolParams.js';
import type { ChainProvider, ProtocolParams } from './provider/types.js';

const LIVE: ProtocolParams = {
  epoch: 200,
  linearFee: { coefficient: '44', constant: '155381' },
  coinsPerUtxoByte: '4310',
  poolDeposit: '500000000',
  keyDeposit: '2000000',
  maxTxSize: 16384,
  maxValueSize: 5000,
};

function provider(network: 'mainnet' | 'preprod' = 'preprod'): jest.Mocked<ChainProvider> {
  return {
    id: 'koios',
    network,
    getProtocolParams: jest.fn(async () => LIVE),
  } as unknown as jest.Mocked<ChainProvider>;
}

beforeEach(() => {
  clearProtocolParamsCache();
});

describe('fetchProtocolParams', () => {
  it('asks the chain rather than using a hardcoded table', async () => {
    const chain = provider();
    await expect(fetchProtocolParams(chain)).resolves.toEqual(LIVE);
    expect(chain.getProtocolParams).toHaveBeenCalledTimes(1);
  });

  it('serves repeat calls from the cache', async () => {
    const chain = provider();
    await fetchProtocolParams(chain);
    await fetchProtocolParams(chain);
    expect(chain.getProtocolParams).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the entry has aged out', async () => {
    const chain = provider();
    let time = 1_000_000;
    const now = () => time;
    await fetchProtocolParams(chain, { now });
    time += CACHE_TTL_MS + 1;
    await fetchProtocolParams(chain, { now });
    expect(chain.getProtocolParams).toHaveBeenCalledTimes(2);
  });

  it('caches per network, so switching chains does not reuse the wrong fees', async () => {
    const preprod = provider('preprod');
    const mainnet = provider('mainnet');
    await fetchProtocolParams(preprod);
    await fetchProtocolParams(mainnet);
    expect(mainnet.getProtocolParams).toHaveBeenCalledTimes(1);
  });

  it('drops one network from the cache without touching the other', async () => {
    const preprod = provider('preprod');
    const mainnet = provider('mainnet');
    await fetchProtocolParams(preprod);
    await fetchProtocolParams(mainnet);
    clearProtocolParamsCache('preprod');
    await fetchProtocolParams(preprod);
    await fetchProtocolParams(mainnet);
    expect(preprod.getProtocolParams).toHaveBeenCalledTimes(2);
    expect(mainnet.getProtocolParams).toHaveBeenCalledTimes(1);
  });

  it('keeps an offline fallback shaped like the live values', () => {
    expect(Object.keys(FALLBACK_PROTOCOL_PARAMS).sort()).toEqual(Object.keys(LIVE).sort());
  });
});
