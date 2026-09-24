import { useEffect, useState, type ReactNode } from 'react';
import { checkPassword } from '../security/password.js';
import { useStore } from '../state/store.js';
import { createSoftwareWallet } from '../wallet/createWallet.js';
import { ErrorText, PageHeading } from './Page.js';
import { LabeledTextInput } from './LabeledTextInput.js';
import { PasswordInput } from './PasswordInput.js';
import { Working } from './Working.js';
import { MUTED } from './theme.js';

type Step = 'name' | 'password' | 'confirm' | 'saving' | 'error';

export interface WalletSetupProps {
  mnemonic: string;
  operation: 'create' | 'restore';
}

/**
 * Shared wallet name/password/save flow. Create and Restore differ only in how
 * they obtain the recovery phrase; everything after that belongs here.
 */
export function WalletSetup({ mnemonic, operation }: WalletSetupProps): ReactNode {
  const { setRoute, setActiveWallet, refreshWalletList, setCapturing } = useStore();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const title = operation === 'create' ? 'Create Wallet' : 'Restore Wallet';

  useEffect(() => {
    setCapturing(step === 'name' || step === 'password' || step === 'confirm');
    return () => setCapturing(false);
  }, [step, setCapturing]);

  useEffect(() => {
    if (step !== 'saving') return;

    // Defer so the Working frame paints before scrypt blocks the event loop.
    const timeout = setTimeout(() => {
      try {
        const wallet = createSoftwareWallet({ name, mnemonic, password });
        setActiveWallet({
          name: wallet.name,
          accountPubKey: wallet.accountPubKey,
          plate: wallet.plate,
        });
        refreshWalletList();
        setRoute('main');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStep('error');
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [step, name, mnemonic, password, setActiveWallet, refreshWalletList, setRoute]);

  if (step === 'name') {
    return (
      <box flexDirection="column">
        <PageHeading title={`${title} — name`} />
        <LabeledTextInput
          label="Wallet name"
          focused
          width={24}
          maxLength={20}
          value={name}
          onInput={(value) => setName(value.slice(0, 20))}
          onSubmit={() => {
            if (name.trim().length === 0) {
              setError('Please enter a name.');
              return;
            }
            setError('');
            setStep('password');
          }}
        />
        {error !== '' && <ErrorText>{error}</ErrorText>}
      </box>
    );
  }

  if (step === 'password') {
    return (
      <box flexDirection="column">
        <PageHeading title={`${title} — spending password`} />
        <PasswordInput
          value={password}
          onChange={setPassword}
          showStrength
          onSubmit={(value) => {
            if (!checkPassword(value).ok) {
              setError('Password is too weak (need a stronger phrase, min 10 chars).');
              return;
            }
            setError('');
            setStep('confirm');
          }}
        />
        {error !== '' && <ErrorText>{error}</ErrorText>}
      </box>
    );
  }

  if (step === 'confirm') {
    return (
      <box flexDirection="column">
        <PageHeading title={`${title} — confirm password`} />
        <PasswordInput
          label="Repeat password"
          value={confirm}
          onChange={setConfirm}
          onSubmit={(value) => {
            if (value !== password) {
              setError('Passwords do not match.');
              return;
            }
            setError('');
            setStep('saving');
          }}
        />
        {error !== '' && <ErrorText>{error}</ErrorText>}
      </box>
    );
  }

  if (step === 'saving') {
    return <Working label="Encrypting and saving wallet…" />;
  }

  return (
    <box flexDirection="column">
      <ErrorText>
        <strong>Could not {operation} wallet</strong>
      </ErrorText>
      <ErrorText>{error}</ErrorText>
      <text fg={MUTED}>Press Esc to go back.</text>
    </box>
  );
}
