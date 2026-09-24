// UI render tests for the Ink app, in pure-node ESM against the tsc build.
//
// Two constraints shape this harness:
//  - jest can't load Ink 5's ESM `yoga-layout` (top-level await + import.meta),
//    so UI runs here under node's native ESM.
//  - `ink-testing-library`'s mock stdin does NOT deliver keystrokes to Ink 5's
//    `useInput` in this environment, so we can't simulate key presses. Instead
//    we mount each page directly via `initialRoute` and render leaf components
//    in isolation. Interactive transitions are verified by running the real
//    binary (`bun run start`) or the optional node-pty e2e (M6).
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../dist/app.js';
import { PasswordInput } from '../dist/components/PasswordInput.js';
import { ProviderSetup } from '../dist/pages/ProviderSetup.js';
import { Settings } from '../dist/pages/Settings.js';
import { Balance } from '../dist/components/Balance.js';
import { AppProvider } from '../dist/state/store.js';
import { RustModule } from '../dist/crypto/rust.js';

await RustModule.load();

// The UI smoke run must never reach the network: the dashboard mounts the real
// Balance component, which would otherwise call whatever provider the developer
// has configured in ~/.yacow. Any accidental request fails fast instead.
globalThis.fetch = async () => {
  throw new Error('smoke: network access is disabled');
};

const ACTIVE = {
  name: 'my-wallet',
  accountPubKey: 'ab'.repeat(64),
  plate: { textPart: 'EHKL-5865', imagePart: 'x'.repeat(128) },
};

let failures = 0;
function check(name, element, expected) {
  const { lastFrame, unmount } = render(element);
  const frame = lastFrame() ?? '';
  const missing = expected.filter((s) => !frame.includes(s));
  unmount();
  if (missing.length === 0) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name} — missing: ${missing.join(' | ')}`);
    console.error(`--- frame ---\n${frame}\n`);
  }
}

const app = (props) => React.createElement(App, props);

check('onboarding (no wallet)', app({ initialWalletList: [], initialActiveWallet: null }), [
  'YACOW',
  'Create a new wallet',
  'quit',
]);

check(
  'dashboard shows plate',
  app({ initialWalletList: ['my-wallet'], initialActiveWallet: ACTIVE }),
  ['my-wallet', 'EHKL-5865', 'send', 'wallets'],
);

check('create: reveal recovery phrase', app({ initialRoute: 'create', initialWalletList: [] }), [
  'recovery phrase',
  ' 1.',
  'Press Enter',
]);

check('restore: phrase entry', app({ initialRoute: 'restore', initialWalletList: [] }), [
  'recovery phrase',
  'Phrase:',
]);

check(
  'wallets list',
  app({ initialRoute: 'wallets', initialWalletList: ['alpha'], initialActiveWallet: ACTIVE }),
  ['alpha', 'Create a new wallet', 'Restore a wallet'],
);

check('network page', app({ initialRoute: 'network', initialWalletList: [] }), [
  'Cardano Mainnet',
  'Cardano Preprod',
  '(current)',
]);

// backlog #6: Create/Restore footers must not offer wallets/network shortcuts
{
  const { lastFrame, unmount } = render(app({ initialRoute: 'create', initialWalletList: [] }));
  const frame = lastFrame() ?? '';
  const ok = frame.includes('esc back') && !/\bwallets\b/.test(frame) && !/\bnetwork\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  create footer is minimal (esc/quit only)`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
  unmount();
}

// onboarding footer must be the fixed set even if wallets exist (no dup 'r' key)
{
  const warnings = [];
  const origErr = console.error;
  console.error = (...a) => warnings.push(a.join(' '));
  const { lastFrame, unmount } = render(
    app({ initialRoute: 'onboarding', initialWalletList: ['w1'], initialActiveWallet: ACTIVE }),
  );
  const frame = lastFrame() ?? '';
  console.error = origErr;
  const noDupKeyWarn = !warnings.some((w) => w.includes('same key'));
  const noWalletNav = !/\bs send\b/.test(frame) && !/\bm main\b/.test(frame);
  const ok = noDupKeyWarn && noWalletNav && /\br restore\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  onboarding footer clean (no dup key / no wallet nav)`);
  if (!ok) {
    failures++;
    console.error(`warnings=${JSON.stringify(warnings)}\n--- frame ---\n${frame}\n`);
  }
  unmount();
}

// wallets are network-agnostic: the header follows the global network, and the
// same active wallet is shown on whichever network is selected
check(
  'header shows the global network (mainnet)',
  app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE, initialNetwork: 'mainnet' }),
  ['Cardano Mainnet', 'my-wallet', 'EHKL-5865'],
);
check(
  'same wallet shown on preprod',
  app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE, initialNetwork: 'preprod' }),
  ['Cardano Preprod', 'my-wallet', 'EHKL-5865'],
);

// footer omits the current page's own shortcut
{
  const { lastFrame, unmount } = render(
    app({ initialWalletList: ['w'], initialActiveWallet: ACTIVE }),
  );
  const frame = lastFrame() ?? '';
  const ok = !/\bm main\b/.test(frame) && /\bs send\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  main footer omits "m main"`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
  unmount();
}
{
  const { lastFrame, unmount } = render(app({ initialRoute: 'network', initialWalletList: [] }));
  const frame = lastFrame() ?? '';
  const ok = !/\bn network\b/.test(frame) && /\bw wallets\b/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  network footer omits "n network"`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
  unmount();
}

// backlog #3: Wallets list offers a remove option when wallets exist
check(
  'wallets: remove option present',
  app({ initialRoute: 'wallets', initialWalletList: ['alpha'], initialActiveWallet: ACTIVE }),
  ['Remove a wallet'],
);

// --- provider gate (plan §12.5, decisions 4.5 / 4.9) ------------------------
// The page is mounted directly with injected choices so the smoke run never
// reads (or depends on) the developer's real ~/.yacow/providers.json.
const setupPage = (choices, network = 'preprod') =>
  React.createElement(
    AppProvider,
    { initialRoute: 'providerSetup', initialNetwork: network, initialWalletList: [] },
    React.createElement(ProviderSetup, { choices, onDone: () => {} }),
  );

check(
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

check(
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

// The gate must not offer any way to navigate away.
{
  const { lastFrame, unmount } = render(
    app({ initialRoute: 'providerSetup', initialWalletList: [] }),
  );
  const frame = lastFrame() ?? '';
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
  unmount();
}

// --- settings: provider x network grid (plan §12.6, decision 4.8) -----------
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
    // One account-wide token, not one per network (decision 4.8).
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

const settingsPage = (network = 'preprod') =>
  React.createElement(
    AppProvider,
    { initialRoute: 'settings', initialNetwork: network, initialWalletList: [] },
    React.createElement(Settings, { rows: ROWS, summary: 'Cardano Preprod served by Blockfrost.' }),
  );

check('settings: grid shows both networks per provider', settingsPage(), [
  'Settings — data providers',
  'Blockfrost',
  'primary',
  'fallback (used when primary is unavailable)',
  'Cardano Mainnet: mainnet****1234',
  'Cardano Preprod: not set',
  '(active)',
]);

check('settings: offers per-network key actions and role swap', settingsPage(), [
  'Add Blockfrost key for Cardano Preprod',
  'Replace Blockfrost key for Cardano Mainnet',
  'Remove Blockfrost key for Cardano Mainnet',
  // Koios is account-wide: one entry, no network in the label.
  'Add Koios token (all networks)',
  'Swap roles (Koios becomes primary)',
  'Test connection on Cardano Preprod',
]);

check('settings: Koios shows one account-wide row, not one per network', settingsPage(), [
  'All networks: not set',
]);

// the masked cell must never widen into a real key
{
  const { lastFrame, unmount } = render(settingsPage());
  const frame = lastFrame() ?? '';
  const ok = !/mainnetABCDEF/.test(frame) && /mainnet\*\*\*\*1234/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  settings keys stay masked`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
  unmount();
}

// the settings shortcut is offered everywhere except on settings itself
{
  const onMain = render(app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE }));
  const mainFrame = onMain.lastFrame() ?? '';
  onMain.unmount();
  const onSettings = render(app({ initialRoute: 'settings', initialWalletList: [] }));
  const settingsFrame = onSettings.lastFrame() ?? '';
  onSettings.unmount();
  const ok = /, settings/.test(mainFrame) && !/, settings/.test(settingsFrame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  footer offers ", settings" except on settings`);
  if (!ok) {
    failures++;
    console.error(`--- main ---\n${mainFrame}\n--- settings ---\n${settingsFrame}\n`);
  }
}

// --- dashboard balance (plan §12.7) -----------------------------------------
// Injected balance: the smoke run must never touch the network or the user's keys.
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

check(
  'balance shows ADA, tokens and which provider served it',
  React.createElement(Balance, {
    wallet: ACTIVE,
    network: 'preprod',
    balance: BALANCE,
    servedBy: 'via Koios — primary unavailable',
  }),
  ['4.5 ADA', 'Tokens:', '5 MILK', '3 HOSKY', 'via Koios — primary unavailable'],
);

check(
  'balance with no tokens shows only ADA',
  React.createElement(Balance, {
    wallet: ACTIVE,
    network: 'preprod',
    balance: { ...BALANCE, tokens: [] },
    servedBy: 'via Blockfrost',
  }),
  ['4.5 ADA', 'via Blockfrost'],
);

// dashboard offers the refresh shortcut once a wallet is active
{
  const { lastFrame, unmount } = render(
    app({ initialWalletList: ['w1'], initialActiveWallet: ACTIVE }),
  );
  const frame = lastFrame() ?? '';
  const ok = /R refresh/.test(frame) && /EHKL-5865/.test(frame);
  console.log(`${ok ? 'PASS' : 'FAIL'}  dashboard mounts balance + refresh hint`);
  if (!ok) {
    failures++;
    console.error(`--- frame ---\n${frame}\n`);
  }
  unmount();
}

check(
  'password input shows strength meter',
  React.createElement(PasswordInput, { value: 'abc', onChange: () => {}, showStrength: true }),
  ['strength'],
);

console.log(failures === 0 ? '\nsmoke: all UI checks passed' : `\nsmoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
