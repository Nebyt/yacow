import { useState, type ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { loadWallet } from '../wallet/createWallet.js';
import { deleteWallet } from '../wallet/deleteWallet.js';
import { MenuSelect, type MenuItem } from '../components/MenuSelect.js';
import { ErrorText, PageHeading } from '../components/Page.js';
import { MUTED } from '../components/theme.js';

type Mode = 'list' | 'delete-select' | 'delete-confirm';

/** Wallets list / add / select / delete (plan §3 Op 1 + backlog #3). */
export function Wallets(): ReactNode {
  const { walletList, activeWallet, setActiveWallet, setRoute, refreshWalletList } = useStore();
  const [mode, setMode] = useState<Mode>('list');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');

  if (mode === 'delete-select') {
    const items: MenuItem<string>[] = [
      ...walletList.map((name) => ({ label: `🗑  ${name}`, value: name })),
      { label: 'Cancel', value: '__cancel__' },
    ];
    return (
      <box flexDirection="column">
        <PageHeading title="Delete a wallet" subtitle="Choose a wallet to remove permanently." />
        <box marginTop={1}>
          <MenuSelect
            items={items}
            onSelect={(item) => {
              if (item.value === '__cancel__') {
                setMode('list');
                return;
              }
              setTarget(item.value);
              setMode('delete-confirm');
            }}
          />
        </box>
      </box>
    );
  }

  if (mode === 'delete-confirm') {
    const items: MenuItem<string>[] = [
      { label: 'No, keep it', value: 'no' },
      { label: `Yes, permanently delete "${target}"`, value: 'yes' },
    ];
    return (
      <box flexDirection="column">
        <ErrorText>
          <strong>Delete wallet “{target}”?</strong>
        </ErrorText>
        <text fg={MUTED}>This removes its keystore file. This cannot be undone.</text>
        <box marginTop={1}>
          <MenuSelect
            items={items}
            onSelect={(item) => {
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
        </box>
      </box>
    );
  }

  const items: MenuItem<string>[] = [
    ...walletList.map((name) => ({ label: `👛 ${name}`, value: name })),
    { label: '＋ Create a new wallet', value: '__create__' },
    { label: '↺ Restore a wallet', value: '__restore__' },
    ...(walletList.length > 0 ? [{ label: '🗑  Remove a wallet', value: '__delete__' }] : []),
  ];

  const onSelect = (item: MenuItem<string>) => {
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
    <box flexDirection="column">
      <PageHeading title="Wallets" />
      {walletList.length === 0 && <text fg={MUTED}>No wallets yet.</text>}
      <box marginTop={1}>
        <MenuSelect items={items} onSelect={onSelect} />
      </box>
      {error !== '' && <ErrorText>{error}</ErrorText>}
    </box>
  );
}
