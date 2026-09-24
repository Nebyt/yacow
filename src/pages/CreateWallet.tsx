import { useState, type ReactNode } from 'react';
import { useKeyboard } from '@opentui/react';
import { generateMnemonic } from '../crypto/mnemonic.js';
import { PageHeading } from '../components/Page.js';
import { WalletSetup } from '../components/WalletSetup.js';
import { FG, INFO, MUTED, WARNING } from '../components/theme.js';

type Step = 'reveal' | 'setup';

/** Create-wallet flow (plan §3 Op 1): reveal → name → password → confirm → save. */
export function CreateWallet(): ReactNode {
  const [mnemonic] = useState(() => generateMnemonic(15));
  const [step, setStep] = useState<Step>('reveal');

  useKeyboard((key) => {
    if (step !== 'reveal') return;
    if (key.name === 'return') {
      key.stopPropagation();
      setStep('setup');
    }
  });

  if (step === 'reveal') {
    const words = mnemonic.split(' ');
    const COLS = 3;
    const rows: string[][] = [];
    for (let i = 0; i < words.length; i += COLS) rows.push(words.slice(i, i + COLS));
    return (
      <box flexDirection="column">
        <PageHeading title="Create Wallet — recovery phrase" />
        <text fg={WARNING}>
          Write these {words.length} words down in order. They are shown only once.
        </text>
        <box marginTop={1} marginBottom={1} flexDirection="column">
          {rows.map((row, r) => (
            <box key={r} flexDirection="row">
              {row.map((w, c) => {
                const n = r * COLS + c + 1;
                return (
                  <box key={c} width={22} flexDirection="row">
                    <text fg={MUTED}>{String(n).padStart(2, ' ')}. </text>
                    <text fg={FG}>
                      <strong>{w}</strong>
                    </text>
                  </box>
                );
              })}
            </box>
          ))}
        </box>
        <text fg={INFO}>Press Enter once you have written them down.</text>
      </box>
    );
  }

  return <WalletSetup operation="create" mnemonic={mnemonic} />;
}
