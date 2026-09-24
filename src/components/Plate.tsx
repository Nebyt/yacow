import type { ReactNode } from 'react';
import type { ActiveWallet } from '../state/store.js';
import { FG, INFO } from './theme.js';

/** Wallet identity line: name + CIP4 plate label + the network it's viewed on. */
export function Plate({ wallet }: { wallet: ActiveWallet }): ReactNode {
  return (
    <text fg={FG}>
      <strong>{wallet.name}</strong> ·{' '}
      <span fg={INFO}>
        <strong>{wallet.plate.textPart}</strong>
      </span>
    </text>
  );
}
