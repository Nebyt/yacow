import { useEffect, useState, type ReactNode } from 'react';
import { getNetwork, type NetworkName } from '../config/networks.js';
import { getProvider } from '../net/provider/registry.js';
import type { ChainProvider } from '../net/provider/types.js';
import { fetchWalletBalance, type WalletBalance } from '../wallet/balance.js';
import type { ActiveWallet } from '../state/store.js';
import { Working } from './Working.js';
import { ChainError } from './Page.js';
import { FG, MUTED, SUCCESS } from './theme.js';

export interface BalanceProps {
  wallet: ActiveWallet;
  network: NetworkName;
  refreshToken?: number;
  provider?: ChainProvider;
  balance?: WalletBalance;
}

export function Balance({
  wallet,
  network,
  refreshToken = 0,
  provider,
  balance: injected,
}: BalanceProps): ReactNode {
  const [balance, setBalance] = useState<WalletBalance | null>(injected ?? null);
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

        const result = await fetchWalletBalance(
          chain,
          wallet.accountPubKey,
          getNetwork(network).networkId,
        );

        if (cancelled) return;

        setBalance(result);
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
    return <Working label="Loading balance…" />;
  }

  if (error != null) {
    return <ChainError subject="Balance" error={error} />;
  }

  return (
    <box flexDirection="column">
      <text fg={SUCCESS}>
        <strong>{balance?.ada ?? '0'} ADA</strong>
      </text>
      {balance != null && balance.tokens.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg={MUTED}>Tokens:</text>
          {balance.tokens.slice(0, 5).map((token) => (
            <text key={token.unit} fg={FG}>
              {'  '}
              {token.display} {token.label}
            </text>
          ))}
          {balance.tokens.length > 5 && (
            <text fg={MUTED}>
              {'  '}+{balance.tokens.length - 5} more
            </text>
          )}
        </box>
      )}
    </box>
  );
}
