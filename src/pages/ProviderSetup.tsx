import { useEffect, useState, type ReactNode } from 'react';
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
import { MenuSelect } from '../components/MenuSelect.js';
import { ErrorText, PageHeading } from '../components/Page.js';
import { ProviderCredentialField } from '../components/ProviderCredentialField.js';
import { Working } from '../components/Working.js';
import { FG, MUTED, WARNING } from '../components/theme.js';

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
export function ProviderSetup({ choices, onDone }: ProviderSetupProps): ReactNode {
  const { network, setNetwork, setRoute, hasWallet, setCapturing } = useStore();
  const [step, setStep] = useState<Step>('choose');
  const [provider, setProvider] = useState<ProviderId>('blockfrost');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const available = choices ?? setupChoices(network);
  const items = available.map((choice, index) => ({ label: choice.label, value: index }));

  useEffect(() => {
    setCapturing(step === 'key' || step === 'failed');
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
    <box flexDirection="column">
      <PageHeading
        title="Connect to Cardano"
        subtitle="YACOW reads the chain through Blockfrost or Koios."
      />

      {step === 'choose' && (
        <box flexDirection="column" marginTop={1}>
          <text fg={FG}>
            No provider is set up for <span fg={WARNING}>{NETWORKS[network].displayName}</span>.
          </text>
          <box marginTop={1}>
            <MenuSelect items={items} onSelect={onSelect} />
          </box>
        </box>
      )}

      {step === 'key' && (
        <box marginTop={1}>
          <ProviderCredentialField
            prompt={
              provider === 'koios'
                ? 'Paste your Koios token (it covers every network):'
                : `Paste your ${label} key for ${NETWORKS[network].displayName}:`
            }
            hint={
              provider === 'blockfrost'
                ? 'Blockfrost project id, from blockfrost.io — it must match this network.'
                : 'Koios token, from koios.rest — one token per account, valid on mainnet and preprod. Leave empty for the anonymous tier.'
            }
            value={key}
            onChange={setKey}
            onSubmit={submitKey}
          />
        </box>
      )}

      {step === 'testing' && <Working label={`Testing the ${label} key…`} />}

      {step === 'failed' && (
        <box flexDirection="column" marginTop={1}>
          <ErrorText>{message}</ErrorText>
          <ProviderCredentialField
            prompt={`Retry the ${label} credential:`}
            hint="Press Enter to test it again."
            value={key}
            onChange={setKey}
            onSubmit={submitKey}
          />
        </box>
      )}
    </box>
  );
}
