import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { NETWORKS, type NetworkName } from '../config/networks.js';
import { setNetworkSetting } from '../config/settings.js';
import {
  makePrimary,
  saveProviderKey,
  setupChoices,
  testProviderKey,
  type SetupChoice,
} from '../config/providerSetup.js';
import { PROVIDER_LABELS, type ProviderId } from '../net/provider/types.js';
import { useStore } from '../state/store.js';

export interface ProviderSetupProps {
  /** Injected in tests; the real app reads the choices from user settings. */
  choices?: SetupChoice[];
  onDone?: () => void;
}

type Step = 'choose' | 'key' | 'testing' | 'failed';

/**
 * The gate (plan §12.5): nothing else in the app works without a way to reach
 * the chain, so this page blocks until a provider answers for the ACTIVE
 * network. Keys for the other network are never touched (decision 4.8).
 */
export function ProviderSetup({ choices, onDone }: ProviderSetupProps): React.ReactElement {
  const { network, setNetwork, setRoute, hasWallet, setCapturing } = useStore();
  const [step, setStep] = useState<Step>('choose');
  const [provider, setProvider] = useState<ProviderId>('blockfrost');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const available = choices ?? setupChoices(network);
  // SelectInput items carry only label/value, so the value is the index into
  // `available` and the choice is looked up on selection.
  const items = available.map((choice, index) => ({ label: choice.label, value: index }));

  // A text field owns the keyboard while a key is being typed.
  useEffect(() => {
    setCapturing(step === 'key');
    return () => setCapturing(false);
  }, [step, setCapturing]);

  const finish = () => {
    if (onDone != null) return onDone();
    setRoute(hasWallet ? 'main' : 'onboarding');
  };

  const switchTo = (target: NetworkName) => {
    setNetwork(target);
    try {
      setNetworkSetting(target);
    } catch {
      // non-fatal: the in-memory choice still applies for this session
    }
    finish();
  };

  const onSelect = (item: { value: number }) => {
    const choice = available[item.value];
    if (choice == null) return;
    if (choice.kind === 'switch-network') return switchTo(choice.network);
    setProvider(choice.provider);
    if (choice.kind === 'use-provider') {
      makePrimary(choice.provider);
      return finish();
    }
    setKey('');
    setMessage(null);
    setStep('key');
  };

  const submitKey = async (value: string) => {
    const trimmed = value.trim();
    setStep('testing');
    // Probe before saving, so a typo is caught here and not on the dashboard.
    const result = await testProviderKey(provider, network, trimmed === '' ? null : trimmed);
    if (!result.ok) {
      setMessage(result.message);
      setStep('failed');
      return;
    }
    saveProviderKey(provider, network, trimmed === '' ? null : trimmed);
    makePrimary(provider);
    finish();
  };

  const label = PROVIDER_LABELS[provider];

  return (
    <Box flexDirection="column">
      <Text bold>Connect to Cardano</Text>
      <Text color="gray">
        YACOW reads the chain through Blockfrost or Koios.
      </Text>

      {step === 'choose' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            No provider is set up for <Text color="yellow">{NETWORKS[network].displayName}</Text>.
          </Text>
          <Box marginTop={1}>
            <SelectInput items={items} onSelect={onSelect} />
          </Box>
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {provider === 'koios'
              ? 'Paste your Koios token (it covers every network):'
              : `Paste your ${label} key for ${NETWORKS[network].displayName}:`}
          </Text>
          <Box>
            <Text>Key: </Text>
            <TextInput value={key} onChange={setKey} onSubmit={submitKey} mask="*" />
          </Box>
          <Text color="gray">
            {provider === 'blockfrost'
              ? 'Blockfrost project id, from blockfrost.io — it must match this network.'
              : 'Koios token, from koios.rest — one token per account, valid on mainnet and preprod. Leave empty for the anonymous tier.'}
          </Text>
        </Box>
      )}

      {step === 'testing' && (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Testing the {label} key…</Text>
        </Box>
      )}

      {step === 'failed' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">{message}</Text>
          <Text color="gray">Press Enter to try again.</Text>
          <Box>
            <Text>Key: </Text>
            <TextInput value={key} onChange={setKey} onSubmit={submitKey} mask="*" />
          </Box>
        </Box>
      )}
    </Box>
  );
}
