import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useStore } from '../state/store.js';
import { loadWallet } from '../wallet/createWallet.js';
import { deleteWallet } from '../wallet/deleteWallet.js';

interface Item {
  label: string;
  value: string;
}

type Mode = 'list' | 'delete-select' | 'delete-confirm';

/** Wallets list / add / select / delete (plan §3 Op 1 + backlog #3). */
export function Wallets(): React.ReactElement {
  const { walletList, activeWallet, setActiveWallet, setRoute, refreshWalletList } = useStore();
  const [mode, setMode] = React.useState<Mode>('list');
  const [target, setTarget] = React.useState('');
  const [error, setError] = React.useState('');

  if (mode === 'delete-select') {
    const items: Item[] = [
      ...walletList.map((name) => ({ label: `🗑  ${name}`, value: name })),
      { label: 'Cancel', value: '__cancel__' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Delete a wallet</Text>
        <Text color="gray">Choose a wallet to remove permanently.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item: Item) => {
              if (item.value === '__cancel__') {
                setMode('list');
                return;
              }
              setTarget(item.value);
              setMode('delete-confirm');
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode === 'delete-confirm') {
    const items: Item[] = [
      { label: 'No, keep it', value: 'no' },
      { label: `Yes, permanently delete "${target}"`, value: 'yes' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold color="red">
          Delete wallet “{target}”?
        </Text>
        <Text color="gray">This removes its keystore file. This cannot be undone.</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item: Item) => {
              if (item.value !== 'yes') {
                setMode('list');
                return;
              }
              try {
                deleteWallet(target);
                if (activeWallet?.name === target) setActiveWallet(null);
                const remaining = walletList.filter((n) => n !== target);
                refreshWalletList();
                if (remaining.length === 0) setRoute('onboarding');
                else setMode('list');
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setMode('list');
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // list mode
  const items: Item[] = [
    ...walletList.map((name) => ({ label: `👛 ${name}`, value: name })),
    { label: '＋ Create a new wallet', value: '__create__' },
    { label: '↺ Restore a wallet', value: '__restore__' },
    ...(walletList.length > 0 ? [{ label: '🗑  Remove a wallet', value: '__delete__' }] : []),
  ];

  const onSelect = (item: Item) => {
    if (item.value === '__create__') return setRoute('create');
    if (item.value === '__restore__') return setRoute('restore');
    if (item.value === '__delete__') return setMode('delete-select');
    try {
      setActiveWallet(loadWallet(item.value));
      setRoute('main');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>Wallets</Text>
      {walletList.length === 0 && <Text color="gray">No wallets yet.</Text>}
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={onSelect} />
      </Box>
      {error !== '' && <Text color="red">{error}</Text>}
    </Box>
  );
}
