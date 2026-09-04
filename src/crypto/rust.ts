// Single entry point to the Cardano serialization library.
//
// The extension loads a browser WASM build asynchronously via a RustModule
// singleton (app/api/ada/lib/cardanoCrypto/rustLoader.js). We use the *nodejs*
// build, which is a synchronous CommonJS require, so load() is a no-op await
// kept only to preserve the same call site the rest of the code expects.
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';

type Csl = typeof CardanoWasm;

let ready = false;

export const RustModule = {
  /** Mirrors the extension's async loader; the nodejs build is already resident. */
  async load(): Promise<void> {
    ready = true;
  },

  get isLoaded(): boolean {
    return ready;
  },

  /** The cardano-serialization-lib namespace. */
  get CSL(): Csl {
    if (!ready) {
      throw new Error('RustModule.load() must be awaited before using the CSL.');
    }
    return CardanoWasm;
  },

  /** Alias matching the extension's `RustModule.WalletV4.*` call style. */
  get WalletV4(): Csl {
    return this.CSL;
  },
};
