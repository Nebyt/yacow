import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { getNetwork, type NetworkName } from '../config/networks.js';
import { getProvider } from '../net/provider/registry.js';
import type { ChainProvider } from '../net/provider/types.js';
import { fetchWalletBalance, type WalletBalance } from '../wallet/balance.js';
import type { ActiveWallet } from '../state/store.js';

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
}: BalanceProps): React.ReactElement {
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
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading balance…</Text>
      </Box>
    );
  }

  if (error != null) {
    return (
      <Box flexDirection="column">
        <Text color="red">Balance unavailable: {error}</Text>
        <Text color="gray">Press R to retry, or , to check your providers.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="green">
          {balance?.ada ?? '0'} ADA
        </Text>
      </Box>
      {balance != null && balance.tokens.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">Tokens:</Text>
          {balance.tokens.slice(0, 5).map((token) => (
            <Text key={token.unit}>
              {'  '}
              {token.display} {token.label}
            </Text>
          ))}
          {balance.tokens.length > 5 && (
            <Text color="gray">
              {'  '}+{balance.tokens.length - 5} more
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
