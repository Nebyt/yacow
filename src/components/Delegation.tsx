import { useEffect, useState, type ReactNode } from 'react';
import type { ActiveWallet } from '../state/store.js';
import type { NetworkName } from '../config/networks.js';
import type { AccountState, ChainProvider, PoolInfo } from '../net/provider/types.js';
import { getProvider } from '../net/provider/registry.js';
import { accountPublicKeyFromHex, rewardAddressBech32FromAccountPublic } from '../crypto/derive.js';
import { Working } from './Working.js';
import { ChainError } from './Page.js';
import { ACCENT, INFO } from './theme.js';

export interface DelegationProps {
  wallet: ActiveWallet;
  network: NetworkName;
  /** Bumped by the R shortcut to force a re-fetch. */
  refreshToken?: number;
  provider?: ChainProvider;
  accountState?: AccountState;
}

export function Delegation({
  wallet,
  network,
  refreshToken = 0,
  provider,
  accountState: injected,
}: DelegationProps): ReactNode {
  const [stakeAddress, setStakeAddress] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<AccountState | null>(injected ?? null);
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(injected == null);

  useEffect(() => {
    if (injected != null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const chain = provider ?? getProvider(network);

        const nextStake = rewardAddressBech32FromAccountPublic(
          accountPublicKeyFromHex(wallet.accountPubKey),
          network,
        );
        setStakeAddress(nextStake);

        const result = await chain.getAccountState(nextStake);
        let nextPool: PoolInfo | null = null;
        if (result?.delegatedPool) {
          nextPool = await chain.getPoolInfo(result.delegatedPool);
        }

        if (cancelled) return;

        setPoolInfo(nextPool);
        setAccountState(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet.accountPubKey, network, refreshToken, provider, injected]);

  if (loading) {
    return <Working label="Loading account state…" />;
  }

  if (error != null) {
    return <ChainError subject="Account state" error={error} />;
  }

  return (
    <box marginTop={1} flexDirection="column">
      <text fg={INFO}>
        <strong>{stakeAddress}</strong>
      </text>
      {accountState?.delegatedPool && (
        <text fg={ACCENT}>
          <strong>{accountState.delegatedPool} </strong>
          {poolInfo != null ? `[${poolInfo.ticker}] ${poolInfo.name}` : ''}
        </text>
      )}
    </box>
  );
}
