import { Box, Text } from "ink";
import { ActiveWallet } from "../state/store.js";
import { NetworkName } from "../config/networks.js";
import { AccountState, ChainProvider, PoolInfo } from "../net/provider/types.js";
import { useEffect, useState } from "react";
import { getProvider } from "../net/provider/registry.js";
import { accountPublicKeyFromHex, rewardAddressBech32FromAccountPublic } from "../crypto/derive.js";
import Spinner from "ink-spinner";

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
}: DelegationProps): React.ReactElement {

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

          const stakeAddress = rewardAddressBech32FromAccountPublic(
            accountPublicKeyFromHex(wallet.accountPubKey),
            network,
          );
          setStakeAddress(stakeAddress);

          const result = await chain.getAccountState(stakeAddress);
          if (result?.delegatedPool){
            const poolInfoResult = await chain.getPoolInfo(result.delegatedPool);
            setPoolInfo(poolInfoResult);
          }
          
  
          if (cancelled) return;
  
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
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading account state…</Text>
      </Box>
    );
  }

  if (error != null) {
      return (
        <Box flexDirection="column">
          <Text color="red">Account state unavailable: {error}</Text>
          <Text color="gray">Press R to retry, or , to check your providers.</Text>
        </Box>
      );
    }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="cyan" bold>
        {stakeAddress}
      </Text>
      {
        accountState?.delegatedPool && (
          <Box>
            <Text color="blue" bold>
              {accountState.delegatedPool + " "}
            </Text>
            {
              poolInfo && (
                <Text color="blueBright">
                  {'[' + poolInfo.ticker + '] ' + poolInfo.name}
                </Text>
              )
            }
          </Box>
        )
      }
    </Box>
  );
}