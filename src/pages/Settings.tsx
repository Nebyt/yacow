import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
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

  // A Koios token covers every network, so its entry says so instead of naming
  // one chain (decision 4.8).
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

/** The provider x network key grid (plan §12.6). Keys are shown masked, always. */
function Grid({
  rows,
  network,
}: {
  rows: ProviderRow[];
  network: NetworkName;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.provider} flexDirection="column" marginTop={1}>
          <Text bold>
            {row.label} <Text color="gray">— {row.roleLabel}</Text>
          </Text>
          {row.cells.map((cell) => {
            // An account-wide cell is always in play, so it is never dimmed.
            const active = cell.scope === 'all' || cell.scope === network;
            return (
              <Text key={cell.scope} color={active ? 'yellow' : 'gray'}>
                {'  '}
                {cell.scopeLabel}: {cell.isSet ? cell.masked : 'not set'}
                {cell.scope === network ? '  (active)' : ''}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export function Settings({ rows, summary }: SettingsProps): React.ReactElement {
  const { network, setRoute, setCapturing } = useStore();
  const [version, setVersion] = useState(0); // bumped to re-read after a write
  const [step, setStep] = useState<Step>('menu');
  const [target, setTarget] = useState<{
    provider: ProviderId;
    network: NetworkName;
    scopeLabel: string;
  } | null>(null);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const current = useMemo(() => rows ?? providerRows(), [rows, version]);
  // Both memos must run unconditionally (hook rules); the injected props simply
  // short-circuit the disk read inside them.
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
    // Only a key that answered gets written, and only for its own network.
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
    <Box flexDirection="column">
      <Text bold>Settings — data providers</Text>
      <Text color="gray">{headline}</Text>
      <Grid rows={current} network={network} />

      {message != null && (
        <Box marginTop={1}>
          <Text color="cyan">{message}</Text>
        </Box>
      )}

      {step === 'menu' && (
        <Box marginTop={1}>
          <SelectInput items={items} onSelect={onSelect} />
        </Box>
      )}

      {step === 'key' && target != null && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {PROVIDER_LABELS[target.provider]}
            {target.provider === 'koios'
              ? ' token (all networks)'
              : ` key for ${target.scopeLabel}`}
            :
          </Text>
          <Box>
            <Text>Key: </Text>
            <TextInput value={key} onChange={setKey} onSubmit={submitKey} mask="*" />
          </Box>
          <Text color="gray">
            {target.provider === 'koios'
              ? 'Leave empty to use the anonymous tier.'
              : 'The project id must match this network.'}
          </Text>
        </Box>
      )}

      {step === 'busy' && (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Contacting the provider…</Text>
        </Box>
      )}
    </Box>
  );
}
