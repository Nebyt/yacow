import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { isValidMnemonic, wordCount } from '../crypto/mnemonic.js';
import { ErrorText, PageHeading } from '../components/Page.js';
import { LabeledTextInput } from '../components/LabeledTextInput.js';
import { WalletSetup } from '../components/WalletSetup.js';

type Step = 'phrase' | 'setup';

/** Restore-wallet flow (plan §3 Op 1): enter phrase → name → password → confirm → save. */
export function RestoreWallet(): ReactNode {
  const { setCapturing } = useStore();
  const [step, setStep] = useState<Step>('phrase');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (step !== 'phrase') return;
    setCapturing(true);
    return () => setCapturing(false);
  }, [step, setCapturing]);

  if (step === 'phrase') {
    return (
      <box flexDirection="column">
        <PageHeading
          title="Restore Wallet — recovery phrase"
          subtitle="Type your 15 or 24 word phrase (space-separated), then Enter."
        />
        <box marginTop={1}>
          <LabeledTextInput
            label="Phrase"
            focused
            fill
            value={phrase}
            onInput={setPhrase}
            onSubmit={() => {
              if (!isValidMnemonic(phrase)) {
                setError(`Invalid recovery phrase (${wordCount(phrase)} words).`);
                return;
              }
              setError('');
              setStep('setup');
            }}
          />
        </box>
        {error !== '' && <ErrorText>{error}</ErrorText>}
      </box>
    );
  }

  return <WalletSetup operation="restore" mnemonic={phrase} />;
}
