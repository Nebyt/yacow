/** @jsxImportSource @opentui/react */
// UI render tests against OpenTUI's in-memory test renderer (decision 5.1).
//
// Engine tests stay on jest. Keystroke-driven flows are still manual (5.2)
// until a node-pty e2e lands (M6). We mount pages via initialRoute / injected
// props and assert the captured character frame.
import { testRender } from '@opentui/react/test-utils';
import type { ReactNode } from 'react';
import { App } from '../src/app.tsx';
import { PasswordInput } from '../src/components/PasswordInput.tsx';
import { WalletSetup } from '../src/components/WalletSetup.tsx';
import { ProviderSetup } from '../src/pages/ProviderSetup.tsx';
import { Settings } from '../src/pages/Settings.tsx';
import { Balance } from '../src/components/Balance.tsx';
import { AppProvider } from '../src/state/store.tsx';
import { RustModule } from '../src/crypto/rust.ts';
import { mnemonicToRootKey } from '../src/crypto/mnemonic.ts';
import { accountPublicKeyHex } from '../src/crypto/derive.ts';
await RustModule.load();

// The same golden phrase the crypto tests use; its plate is EHKL-5865. Pages
// that derive an address (Receive) need a key that is a real curve point.
const FIXED_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';

const origError = console.error;
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  if (first.includes('not wrapped in act')) return;
  origError(...args);
};

globalThis.fetch = async () => {
  throw new Error('smoke: network access is disabled');
};

const ACTIVE = {
  name: 'my-wallet',
  accountPubKey: accountPublicKeyHex(mnemonicToRootKey(FIXED_PHRASE)),
  plate: { textPart: 'EHKL-5865', imagePart: 'x'.repeat(128) },
};

let failures = 0;

async function frameOf(node: ReactNode, width = 100, height = 40): Promise<string> {
  const setup = await testRender(node, { width, height });
  try {
    await setup.flush();
    return setup.captureCharFrame();
  } finally {
    setup.renderer.destroy();
  }
}

async function check(
  name: string,
  element: ReactNode,
  expected: string[],
  height?: number,
): Promise<void> {
  const frame = await frameOf(element, 100, height);
  const missing = expected.filter((s) => !frame.includes(s));
  if (missing.length === 0) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name} — missing: ${missing.join(' | ')}`);
    console.error(`--- frame ---\n${frame}\n`);
  }
}

const app = (props: Parameters<typeof App>[0]) => <App {...props} />;

await check('onboarding (no wallet)', app({ initialWalletList: [], initialActiveWallet: null }), [
  'YACOW',
  'Create a new wallet',
  'quit',
]);

await check(
  'dashboard shows plate',
  app({ initialWalletList: ['my-wallet'], initialActiveWallet: ACTIVE }),
  ['my-wallet', 'EHKL-5865', 'send', 'wallets'],
);

await check(
  'create: reveal recovery phrase',
  app({ initialRoute: 'create', initialWalletList: [] }),
  ['recovery phrase', ' 1.', 'Press Enter'],
);

await check('restore: phrase entry', app({ initialRoute: 'restore', initialWalletList: [] }), [
  'recovery phrase',
  'Phrase:',
]);

await check(
  'shared wallet setup starts with the name field',
  <AppProvider initialWalletList={[]} initialActiveWallet={null}>
    <WalletSetup operation="create" mnemonic={FIXED_PHRASE} />
  </AppProvider>,
  ['Create Wallet — name', 'Wallet name:'],
);

await check(
  'wallets list',
  app({ initialRoute: 'wallets', initialWalletList: ['alpha'], initialActiveWallet: ACTIVE }),
  ['alpha', 'Create a new wallet', 'Restore a wallet'],
);

await check('network page', app({ initialRoute: 'network', initialWalletList: [] }), [
  'Cardano Mainnet',
  'Cardano Preprod',
  '(current)',
]);

{
  const frame = await frameOf(app({ initialRoute: 'create', initialWalletList: [] }));
  const ok = frame.includes('esc back') && !/\bwallets\b/.test(frame) && !/\bnetwork\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  create footer is minimal (esc/quit only)`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}

{
  const warnings: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => warnings.push(a.join(' '));
  const frame = await frameOf(
    app({ initialRoute: 'onboarding', initialWalletList: ['w1'], initialActiveWallet: ACTIVE }),
  );
  console.error = origErr;
  const noDupKeyWarn = !warnings.some((w) => w.includes('same key'));
  const noWalletNav = !/\bs send\b/.test(frame) && !/\bm main\b/.test(frame);
  const ok = noDupKeyWarn && noWalletNav && /\br restore\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  onboarding footer clean (no dup key / no wallet nav)`);
  if (!ok) {
    failures++;
    console.error(`warnings=${JSON.stringify(warnings)}\n--- frame ---\n${frame}\n`);
  }
}

await check(
  'header shows the global network (mainnet)',
  app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE, initialNetwork: 'mainnet' }),
  ['Cardano Mainnet', 'my-wallet', 'EHKL-5865'],
);
await check(
  'same wallet shown on preprod',
  app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE, initialNetwork: 'preprod' }),
  ['Cardano Preprod', 'my-wallet', 'EHKL-5865'],
);

{
  const frame = await frameOf(app({ initialWalletList: ['w'], initialActiveWallet: ACTIVE }));
  const ok = !/\bm main\b/.test(frame) && /\bs send\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  main footer omits "m main"`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}
{
  const frame = await frameOf(app({ initialRoute: 'network', initialWalletList: [] }));
  const ok = !/\bn network\b/.test(frame) && /\bw wallets\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  network footer omits "n network"`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}

// Receive once took the whole page down when it rendered its QR. The symbol
// itself is covered by src/components/qrMatrix.test.ts; this just asserts the
// page mounts. It needs a tall viewport — the QR alone is over 50 rows.
await check(
  'receive: address, path and QR render',
  app({ initialRoute: 'receive', initialWalletList: ['my-wallet'], initialActiveWallet: ACTIVE }),
  ['Receive', 'addr_test1', "m/1852'/1815'/0'/0/0"],
  70,
);

// A QR that does not fit used to be squeezed on top of the address row.
await check(
  'receive: short terminal keeps the address readable',
  app({ initialRoute: 'receive', initialWalletList: ['my-wallet'], initialActiveWallet: ACTIVE }),
  ['addr_test1', "m/1852'/1815'/0'/0/0", 'Resize to'],
  20,
);

await check(
  'wallets: remove option present',
  app({ initialRoute: 'wallets', initialWalletList: ['alpha'], initialActiveWallet: ACTIVE }),
  ['Remove a wallet'],
);

const setupPage = (choices: unknown[], network: 'mainnet' | 'preprod' = 'preprod') => (
  <AppProvider initialRoute="providerSetup" initialNetwork={network} initialWalletList={[]}>
    <ProviderSetup choices={choices as never} onDone={() => {}} />
  </AppProvider>
);

await check(
  'provider setup: fresh install offers both providers',
  setupPage([
    {
      kind: 'add-key',
      provider: 'blockfrost',
      network: 'preprod',
      label: 'Add a Blockfrost key for Cardano Preprod',
    },
    {
      kind: 'add-key',
      provider: 'koios',
      network: 'preprod',
      label: 'Add a Koios key for Cardano Preprod',
    },
  ]),
  ['Connect to Cardano', 'No provider is set up for', 'Cardano Preprod', 'Add a Blockfrost key'],
);

await check(
  'provider setup: unconfigured network offers the fallback and a way back',
  setupPage(
    [
      {
        kind: 'use-provider',
        provider: 'koios',
        network: 'mainnet',
        label: 'Use Koios (key already set for mainnet)',
      },
      {
        kind: 'add-key',
        provider: 'blockfrost',
        network: 'mainnet',
        label: 'Add a Blockfrost key for Cardano Mainnet',
      },
      { kind: 'switch-network', network: 'preprod', label: 'Switch back to Cardano Preprod' },
    ],
    'mainnet',
  ),
  ['Cardano Mainnet', 'Use Koios', 'Add a Blockfrost key', 'Switch back to Cardano Preprod'],
);

{
  const frame = await frameOf(app({ initialRoute: 'providerSetup', initialWalletList: [] }));
  const ok =
    /\bq quit\b/.test(frame) &&
    !/\bw wallets\b/.test(frame) &&
    !/\bn network\b/.test(frame) &&
    !/\besc back\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  provider gate footer offers quit only`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}

const ROWS = [
  {
    provider: 'blockfrost',
    label: 'Blockfrost',
    role: 'primary',
    roleLabel: 'primary',
    perNetwork: true,
    cells: [
      {
        scope: 'mainnet',
        scopeLabel: 'Cardano Mainnet',
        network: 'mainnet',
        masked: 'mainnet****1234',
        isSet: true,
        fromEnv: false,
        usable: true,
      },
      {
        scope: 'preprod',
        scopeLabel: 'Cardano Preprod',
        network: 'preprod',
        masked: '(not set)',
        isSet: false,
        fromEnv: false,
        usable: false,
      },
    ],
  },
  {
    provider: 'koios',
    label: 'Koios',
    role: 'fallback',
    roleLabel: 'fallback (used when primary is unavailable)',
    perNetwork: false,
    cells: [
      {
        scope: 'all',
        scopeLabel: 'All networks',
        network: 'mainnet',
        masked: '(not set)',
        isSet: false,
        fromEnv: false,
        usable: true,
      },
    ],
  },
];

const settingsPage = (network: 'mainnet' | 'preprod' = 'preprod') => (
  <AppProvider initialRoute="settings" initialNetwork={network} initialWalletList={[]}>
    <Settings rows={ROWS as never} summary="Cardano Preprod served by Blockfrost." />
  </AppProvider>
);

await check('settings: grid shows both networks per provider', settingsPage(), [
  'Settings — data providers',
  'Blockfrost',
  'primary',
  'fallback (used when primary is unavailable)',
  'Cardano Mainnet: mainnet****1234',
  'Cardano Preprod: not set',
  '(active)',
]);

await check('settings: offers per-network key actions and role swap', settingsPage(), [
  'Add Blockfrost key for Cardano Preprod',
  'Replace Blockfrost key for Cardano Mainnet',
  'Remove Blockfrost key for Cardano Mainnet',
  'Add Koios token (all networks)',
  'Swap roles (Koios becomes primary)',
  'Test connection on Cardano Preprod',
]);

await check('settings: Koios shows one account-wide row, not one per network', settingsPage(), [
  'All networks: not set',
]);

{
  const frame = await frameOf(settingsPage());
  const ok = !/mainnetABCDEF/.test(frame) && /mainnet\*\*\*\*1234/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  settings keys stay masked`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}

{
  const mainFrame = await frameOf(app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE }));
  const settingsFrame = await frameOf(app({ initialRoute: 'settings', initialWalletList: [] }));
  const ok = /, settings/.test(mainFrame) && !/, settings/.test(settingsFrame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  footer offers ", settings" except on settings`);
  if (!ok) {
    failures++;
    console.error(`--- main ---\n${mainFrame}\n--- settings ---\n${settingsFrame}\n`);
  }
}

const BALANCE = {
  lovelace: '4500000',
  ada: '4.5',
  tokens: [
    { unit: 'aa', quantity: '5000000', label: 'MILK', decimals: 6, display: '5' },
    { unit: 'bb', quantity: '3', label: 'HOSKY', decimals: 0, display: '3' },
  ],
  addresses: ['addr_test1...'],
  nextUnusedAddress: 'addr_test1...',
};

await check(
  'balance shows ADA and tokens',
  <Balance wallet={ACTIVE} network="preprod" balance={BALANCE} />,
  ['4.5 ADA', 'Tokens:', '5 MILK', '3 HOSKY'],
);

await check(
  'balance with no tokens shows only ADA',
  <Balance wallet={ACTIVE} network="preprod" balance={{ ...BALANCE, tokens: [] }} />,
  ['4.5 ADA'],
);

{
  const frame = await frameOf(app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE }));
  const ok = /R refresh/.test(frame) && /EHKL-5865/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  dashboard mounts balance + refresh hint`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
}

await check(
  'password input shows strength meter',
  <PasswordInput value="abc" onChange={() => {}} showStrength />,
  ['strength'],
);

console.log(failures === 0 ? '\nsmoke: all UI checks passed' : `\nsmoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
