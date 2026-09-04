import React from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useStore } from '../state/store.js';
import { generateMnemonic } from '../crypto/mnemonic.js';
import { checkPassword } from '../security/password.js';
import { createSoftwareWallet } from '../wallet/createWallet.js';
import { PasswordInput } from '../components/PasswordInput.js';

type Step = 'reveal' | 'name' | 'password' | 'confirm' | 'saving' | 'error';

/** Create-wallet flow (plan §3 Op 1): reveal → name → password → confirm → save. */
export function CreateWallet(): React.ReactElement {
  const { setRoute, setActiveWallet, refreshWalletList, setCapturing } = useStore();
  const [mnemonic] = React.useState(() => generateMnemonic(15));
  const [step, setStep] = React.useState<Step>('reveal');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState('');

  // Suspend global shortcuts while a text field is focused.
  React.useEffect(() => {
    setCapturing(step === 'name' || step === 'password' || step === 'confirm');
    return () => setCapturing(false);
  }, [step, setCapturing]);

  // Advance from the mnemonic reveal on Enter (only active on that step).
  useInput(
    (_input, key) => {
      if (key.return) setStep('name');
    },
    { isActive: step === 'reveal' },
  );

  // Perform the (blocking) save once we enter the saving step.
  React.useEffect(() => {
    if (step !== 'saving') return;
    // Defer so the "Saving…" frame paints before scrypt blocks the loop.
    const t = setTimeout(() => {
      try {
        const w = createSoftwareWallet({ name, mnemonic, password });
        setActiveWallet({ name: w.name, accountPubKey: w.accountPubKey, plate: w.plate });
        refreshWalletList();
        setRoute('main');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep('error');
      }
    }, 0);
    return () => clearTimeout(t);
  }, [step, name, mnemonic, password, setActiveWallet, refreshWalletList, setRoute]);

  if (step === 'reveal') {
    const words = mnemonic.split(' ');
    const COLS = 3;
    const rows: string[][] = [];
    for (let i = 0; i < words.length; i += COLS) rows.push(words.slice(i, i + COLS));
    return (
      <Box flexDirection="column">
        <Text bold>Create Wallet — recovery phrase</Text>
        <Text color="yellow">
          Write these {words.length} words down in order. They are shown only once.
        </Text>
        <Box marginY={1} flexDirection="column">
          {rows.map((row, r) => (
            <Box key={r}>
              {row.map((w, c) => {
                const n = r * COLS + c + 1;
                return (
                  <Box key={c} width={22}>
                    <Text color="gray">{String(n).padStart(2, ' ')}. </Text>
                    <Text bold>{w}</Text>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
        <Text color="cyan">Press Enter once you have written them down.</Text>
      </Box>
    );
  }

  if (step === 'name') {
    return (
      <Box flexDirection="column">
        <Text bold>Create Wallet — name</Text>
        <Box>
          <Text>Wallet name: </Text>
          <TextInput
            value={name}
            onChange={(v) => setName(v.slice(0, 20))}
            onSubmit={(v) => {
              if (v.trim().length === 0) {
                setError('Please enter a name.');
                return;
              }
              setError('');
              setStep('password');
            }}
          />
        </Box>
        {error !== '' && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === 'password') {
    return (
      <Box flexDirection="column">
        <Text bold>Create Wallet — spending password</Text>
        <PasswordInput
          value={password}
          onChange={setPassword}
          showStrength
          onSubmit={(v) => {
            if (!checkPassword(v).ok) {
              setError('Password is too weak (need a stronger phrase, min 10 chars).');
              return;
            }
            setError('');
            setStep('confirm');
          }}
        />
        {error !== '' && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === 'confirm') {
    return (
      <Box flexDirection="column">
        <Text bold>Create Wallet — confirm password</Text>
        <PasswordInput
          label="Repeat password"
          value={confirm}
          onChange={setConfirm}
          onSubmit={(v) => {
            if (v !== password) {
              setError('Passwords do not match.');
              return;
            }
            setError('');
            setStep('saving');
          }}
        />
        {error !== '' && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === 'saving') {
    return (
      <Text>
        <Text color="green">
          <Spinner type="dots" />
        </Text>{' '}
        Encrypting and saving wallet…
      </Text>
    );
  }

  // error
  return (
    <Box flexDirection="column">
      <Text bold color="red">
        Could not create wallet
      </Text>
      <Text>{error}</Text>
      <Text color="gray">Press Esc to go back.</Text>
    </Box>
  );
}
