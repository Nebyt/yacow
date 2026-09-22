#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { RustModule } from './crypto/rust.js';
import { ensureSecureDir, DEFAULT_HOME_DIR } from './security/fsPerms.js';
import { listWallets } from './wallet/discoverWallets.js';
import { loadWallet, type WalletMeta } from './wallet/createWallet.js';
import { readSettings } from './config/settings.js';
import { isConfigured } from './config/providers.js';
import { initialRoute } from './state/routing.js';
import { abortInFlightRequests } from './net/provider/shutdown.js';

async function main(): Promise<void> {
  // WASM must be ready before any crypto call (plan §2 startup gate).
  await RustModule.load();

  // Ensure ~/.yacow exists and is owner-only.
  ensureSecureDir(DEFAULT_HOME_DIR);

  const wallets = listWallets();
  let active: WalletMeta | null = null;
  if (wallets.length > 0) {
    try {
      active = loadWallet(wallets[0]);
    } catch {
      active = null; // keystore unreadable/insecure; user can pick from Wallets
    }
  }

  // Wallets are network-agnostic; the active network is a saved preference.
  const network = readSettings().network;

  // No provider for this network means no balance, no history and no send, so
  // setup is the only screen worth showing (plan §12.5, decision 4.9).
  const route = initialRoute({
    providerConfigured: isConfigured(network),
    hasWallet: active != null || wallets.length > 0,
  });

  const { waitUntilExit } = render(
    <App
      initialWalletList={wallets}
      initialActiveWallet={active}
      initialNetwork={network}
      initialRoute={route}
    />,
  );
  await waitUntilExit();

  // The UI is gone; stop everything it started. Without this, a balance refresh
  // in flight (fetches, retry backoff, rate-limiter waits) keeps the event loop
  // alive and the app appears to hang after the user pressed q.
  abortInFlightRequests();
}

main()
  .then(() => {
    // Sockets held open by keep-alive can still outlive the abort, so leave
    // deliberately rather than waiting on them.
    process.exit(0);
  })
  .catch((err: unknown) => {
    abortInFlightRequests();
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
