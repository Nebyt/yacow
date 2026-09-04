import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { useStore } from '../state/store.js';
import { isValidMnemonic, wordCount } from '../crypto/mnemonic.js';
import { checkPassword } from '../security/password.js';
import { createSoftwareWallet } from '../wallet/createWallet.js';
import { PasswordInput } from '../components/PasswordInput.js';

type Step = 'phrase' | 'name' | 'password' | 'confirm' | 'saving' | 'error';

/** Restore-wallet flow (plan §3 Op 1): enter phrase → name → password → confirm → save. */
export function RestoreWallet(): React.ReactElement {
  const { setRoute, setActiveWallet, refreshWalletList, setCapturing } = useStore();
  const [step, setStep] = React.useState<Step>('phrase');
  const [phrase, setPhrase] = React.useState('');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    setCapturing(step === 'phrase' || step === 'name' || step === 'password' || step === 'confirm');
    return () => setCapturing(false);
  }, [step, setCapturing]);

  React.useEffect(() => {
    if (step !== 'saving') return;
    const t = setTimeout(() => {
      try {
        const w = createSoftwareWallet({ name, mnemonic: phrase, password });
        setActiveWallet({ name: w.name, accountPubKey: w.accountPubKey, plate: w.plate });
        refreshWalletList();
        setRoute('main');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep('error');
      }
    }, 0);
    return () => clearTimeout(t);
  }, [step, name, phrase, password, setActiveWallet, refreshWalletList, setRoute]);

  if (step === 'phrase') {
    return (
      <Box flexDirection="column">
        <Text bold>Restore Wallet — recovery phrase</Text>
        <Text color="gray">Type your 15 or 24 word phrase (space-separated), then Enter.</Text>
        <Box marginTop={1}>
          <Text>Phrase: </Text>
          <TextInput
            value={phrase}
            onChange={setPhrase}
            onSubmit={(v) => {
              if (!isValidMnemonic(v)) {
                setError(`Invalid recovery phrase (${wordCount(v)} words).`);
                return;
              }
              setError('');
              setStep('name');
            }}
          />
        </Box>
        {error !== '' && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (step === 'name') {
    return (
      <Box flexDirection="column">
        <Text bold>Restore Wallet — name</Text>
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
        <Text bold>Restore Wallet — spending password</Text>
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
        <Text bold>Restore Wallet — confirm password</Text>
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

  return (
    <Box flexDirection="column">
      <Text bold color="red">
        Could not restore wallet
      </Text>
      <Text>{error}</Text>
      <Text color="gray">Press Esc to go back.</Text>
    </Box>
  );
}
