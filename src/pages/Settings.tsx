import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NETWORKS, type NetworkName } from '../config/networks.js';
import { saveProviderKey, testProviderKey } from '../config/providerSetup.js';
import {
  clearFallback,
  describeActiveProviders,
  providerRows,
  removeKey,
  swapRoles,
  type ProviderRow,
} from '../config/providerStatus.js';
import { PROVIDER_LABELS, type ProviderId } from '../net/provider/types.js';
import { useStore } from '../state/store.js';
import { MenuSelect } from '../components/MenuSelect.js';
import { PageHeading } from '../components/Page.js';
import { ProviderCredentialField } from '../components/ProviderCredentialField.js';
import { Working } from '../components/Working.js';
import { FG, INFO, MUTED, WARNING } from '../components/theme.js';

export interface SettingsProps {
  /** Injected in tests; the real page reads them from user settings. */
  rows?: ProviderRow[];
  summary?: string;
}

type Action =
  | { kind: 'set-key'; provider: ProviderId; network: NetworkName; scopeLabel: string }
  | { kind: 'remove-key'; provider: ProviderId; network: NetworkName; scopeLabel: string }
  | { kind: 'swap' }
  | { kind: 'clear-fallback' }
  | { kind: 'test' }
  | { kind: 'network' }
  | { kind: 'back' };

type Step = 'menu' | 'key' | 'busy';

function actionsFor(
  rows: ProviderRow[],
  network: NetworkName,
): { label: string; action: Action }[] {
  const items: { label: string; action: Action }[] = [];

  const scopeOf = (row: ProviderRow, cell: ProviderRow['cells'][number]): string =>
    row.perNetwork ? `for ${cell.scopeLabel}` : '(all networks)';

  for (const row of rows) {
    for (const cell of row.cells) {
      const noun = row.perNetwork ? 'key' : 'token';
      items.push({
        label: `${cell.isSet ? 'Replace' : 'Add'} ${row.label} ${noun} ${scopeOf(row, cell)}`,
        action: {
          kind: 'set-key',
          provider: row.provider,
          network: cell.network,
          scopeLabel: cell.scopeLabel,
        },
      });
    }
  }
  for (const row of rows) {
    for (const cell of row.cells.filter((c) => c.isSet && !c.fromEnv)) {
      items.push({
        label: `Remove ${row.label} ${row.perNetwork ? 'key' : 'token'} ${scopeOf(row, cell)}`,
        action: {
          kind: 'remove-key',
          provider: row.provider,
          network: cell.network,
          scopeLabel: cell.scopeLabel,
        },
      });
    }
  }

  const primary = rows.find((row) => row.role === 'primary');
  const fallback = rows.find((row) => row.role === 'fallback');
  if (primary != null && fallback != null) {
    items.push({
      label: `Swap roles (${fallback.label} becomes primary)`,
      action: { kind: 'swap' },
    });
    items.push({
      label: `Stop using ${fallback.label} as fallback`,
      action: { kind: 'clear-fallback' },
    });
  }

  items.push({
    label: `Test connection on ${NETWORKS[network].displayName}`,
    action: { kind: 'test' },
  });
  items.push({ label: 'Switch network', action: { kind: 'network' } });
  items.push({ label: 'Back', action: { kind: 'back' } });
  return items;
}

function Grid({ rows, network }: { rows: ProviderRow[]; network: NetworkName }): ReactNode {
  return (
    <box flexDirection="column">
      {rows.map((row) => (
        <box key={row.provider} flexDirection="column" marginTop={1}>
          <text fg={FG}>
            <strong>{row.label}</strong>
            <span fg={MUTED}> — {row.roleLabel}</span>
          </text>
          {row.cells.map((cell) => {
            const active = cell.scope === 'all' || cell.scope === network;
            return (
              <text key={cell.scope} fg={active ? WARNING : MUTED}>
                {'  '}
                {cell.scopeLabel}: {cell.isSet ? cell.masked : 'not set'}
                {cell.scope === network ? '  (active)' : ''}
              </text>
            );
          })}
        </box>
      ))}
    </box>
  );
}

export function Settings({ rows, summary }: SettingsProps): ReactNode {
  const { network, setRoute, setCapturing } = useStore();
  const [version, setVersion] = useState(0);
  const [step, setStep] = useState<Step>('menu');
  const [target, setTarget] = useState<{
    provider: ProviderId;
    network: NetworkName;
    scopeLabel: string;
  } | null>(null);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const current = useMemo(() => rows ?? providerRows(), [rows, version]);
  const headline = useMemo(
    () => summary ?? describeActiveProviders(network),
    [summary, network, version],
  );
  const actions = useMemo(() => actionsFor(current, network), [current, network]);
  const items = actions.map((entry, index) => ({ label: entry.label, value: index }));

  useEffect(() => {
    setCapturing(step === 'key');
    return () => setCapturing(false);
  }, [step, setCapturing]);

  const refresh = () => setVersion((n) => n + 1);

  const onSelect = (item: { value: number }) => {
    const action = actions[item.value]?.action;
    if (action == null) return;
    switch (action.kind) {
      case 'set-key':
        setTarget({
          provider: action.provider,
          network: action.network,
          scopeLabel: action.scopeLabel,
        });
        setKey('');
        setMessage(null);
        setStep('key');
        return;
      case 'remove-key':
        removeKey(action.provider, action.network);
        setMessage(
          action.provider === 'blockfrost'
            ? `Removed the Blockfrost key for ${action.network}. The other network keeps its key.`
            : 'Removed the Koios token. Koios still works on the anonymous tier.',
        );
        refresh();
        return;
      case 'swap':
        swapRoles();
        setMessage('Roles swapped.');
        refresh();
        return;
      case 'clear-fallback':
        clearFallback();
        setMessage('Fallback cleared.');
        refresh();
        return;
      case 'test':
        void runTest();
        return;
      case 'network':
        setRoute('network');
        return;
      case 'back':
      default:
        setRoute('main');
    }
  };

  const runTest = async () => {
    const primary = current.find((row) => row.role === 'primary');
    if (primary == null) {
      setMessage('No primary provider is set.');
      return;
    }
    setStep('busy');
    const result = await testProviderKey(primary.provider, network, null);
    setMessage(result.message);
    setStep('menu');
  };

  const submitKey = async (value: string) => {
    if (target == null) return;
    const trimmed = value.trim();
    setStep('busy');
    const result = await testProviderKey(
      target.provider,
      target.network,
      trimmed === '' ? null : trimmed,
    );
    if (!result.ok) {
      setMessage(result.message);
      setStep('key');
      return;
    }
    saveProviderKey(target.provider, target.network, trimmed === '' ? null : trimmed);
    setMessage(
      target.provider === 'koios'
        ? 'Koios token saved. It covers every network.'
        : `Blockfrost key saved for ${target.network}.`,
    );
    setStep('menu');
    refresh();
  };

  return (
    <box flexDirection="column">
      <PageHeading title="Settings — data providers" subtitle={headline} />
      <Grid rows={current} network={network} />

      {message != null && (
        <box marginTop={1}>
          <text fg={INFO}>{message}</text>
        </box>
      )}

      {step === 'menu' && (
        <box marginTop={1}>
          <MenuSelect items={items} onSelect={onSelect} />
        </box>
      )}

      {step === 'key' && target != null && (
        <box marginTop={1}>
          <ProviderCredentialField
            prompt={`${PROVIDER_LABELS[target.provider]}${
              target.provider === 'koios'
                ? ' token (all networks)'
                : ` key for ${target.scopeLabel}`
            }
            :`}
            hint={
              target.provider === 'koios'
                ? 'Leave empty to use the anonymous tier.'
                : 'The project id must match this network.'
            }
            value={key}
            onChange={setKey}
            onSubmit={submitKey}
          />
        </box>
      )}

      {step === 'busy' && <Working label="Contacting the provider…" />}
    </box>
  );
}
