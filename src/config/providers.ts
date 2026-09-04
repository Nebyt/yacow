// Provider credentials, persisted once and reused for every request
// (plan §12.4 B6, decisions 4.4 / 4.8 / 4.9).
//
// Each provider is stored the way it actually works (decision 4.8):
//
//   - **Blockfrost** keys are per network. The project id itself is scoped: it
//     is prefixed `mainnet.../preprod...` and the other host rejects it. So both
//     networks' ids are held at once and switching network picks the matching
//     one with no prompt, never touching the other entry -- a wallet is
//     network-agnostic (decision 3.8), so the user crosses chains constantly.
//   - **Koios** has ONE account-wide token. Networks are separate hosts
//     (api./preprod./preview.koios.rest) but the JWT is issued per account on
//     the Koios profile page and only sets your rate-limit tier, so the same
//     token is sent whatever the network. Asking for it twice would be asking
//     the user to paste the same string into two boxes.
//
// Nothing here ever prints a key: `maskKey` is the only rendering path, and the
// env overrides are read but never written back to disk.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME_DIR, writeSecureFile } from '../security/fsPerms.js';
import { isNetworkName, type NetworkName } from './networks.js';
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../net/provider/types.js';

/** Per-network key slots. `null` = not set. */
export type ProviderKeys = Record<NetworkName, string | null>;

export interface ProviderSettings {
  /** The provider requests go to first. Null until the user completes setup. */
  primary: ProviderId | null;
  /** Optional stand-in used when the primary is unavailable (decision 4.3). */
  fallback: ProviderId | null;
  keys: {
    /** Network-scoped project ids. */
    blockfrost: ProviderKeys;
    /** One account-wide JWT, or null for the anonymous tier. */
    koios: string | null;
  };
}

/** Does this provider need a separate key per network? Blockfrost does. */
export function isPerNetworkProvider(provider: ProviderId): boolean {
  return provider === 'blockfrost';
}

export const ENV_VARS = Object.freeze({
  blockfrost: 'YACOW_BLOCKFROST_PROJECT_ID',
  koios: 'YACOW_KOIOS_TOKEN',
  primary: 'YACOW_PROVIDER_PRIMARY',
});

export type Env = Record<string, string | undefined>;

export interface ReadOptions {
  homeDir?: string;
  env?: Env;
}

export function providersPath(homeDir: string = DEFAULT_HOME_DIR): string {
  return join(homeDir, 'providers.json');
}

function emptyKeys(): ProviderKeys {
  return { mainnet: null, preprod: null };
}

export function defaultProviderSettings(): ProviderSettings {
  return { primary: null, fallback: null, keys: { blockfrost: emptyKeys(), koios: null } };
}

function sanitiseKeys(raw: unknown): ProviderKeys {
  const keys = emptyKeys();
  if (raw == null || typeof raw !== 'object') return keys;
  for (const [network, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isNetworkName(network) && typeof value === 'string' && value.trim() !== '') {
      keys[network] = value.trim();
    }
  }
  return keys;
}

/**
 * The Koios token. Also accepts the older per-network shape written before the
 * account-wide token was understood, collapsing it to the first value found.
 */
function sanitiseToken(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw.trim();
  if (raw == null || typeof raw !== 'object') return null;
  const legacy = sanitiseKeys(raw);
  return legacy.mainnet ?? legacy.preprod;
}

function sanitiseProviderId(raw: unknown): ProviderId | null {
  return typeof raw === 'string' && isProviderId(raw) ? raw : null;
}

/** Read the file, tolerating anything malformed by falling back to defaults. */
export function readProviders(homeDir?: string): ProviderSettings {
  const path = providersPath(homeDir);
  if (!existsSync(path)) return defaultProviderSettings();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const rawKeys = (raw.keys ?? {}) as Record<string, unknown>;
    const settings = defaultProviderSettings();
    settings.primary = sanitiseProviderId(raw.primary);
    settings.fallback = sanitiseProviderId(raw.fallback);
    settings.keys.blockfrost = sanitiseKeys(rawKeys.blockfrost);
    settings.keys.koios = sanitiseToken(rawKeys.koios);
    // A provider cannot be both roles; the primary wins.
    if (settings.fallback === settings.primary) settings.fallback = null;
    return settings;
  } catch {
    return defaultProviderSettings();
  }
}

export function writeProviders(settings: ProviderSettings, homeDir?: string): void {
  writeSecureFile(providersPath(homeDir), JSON.stringify(settings, null, 2));
}

/** Read a stored key out of already-loaded settings (env is NOT consulted). */
export function keyOf(
  settings: ProviderSettings,
  provider: ProviderId,
  network: NetworkName,
): string | null {
  // Koios ignores the network: one account-wide token serves every host.
  return provider === 'blockfrost' ? settings.keys.blockfrost[network] : settings.keys.koios;
}

/**
 * The stored key for one provider on one network (env is NOT consulted here).
 * `network` is ignored for Koios, whose token is account-wide.
 */
export function getKey(
  provider: ProviderId,
  network: NetworkName,
  homeDir?: string,
): string | null {
  return keyOf(readProviders(homeDir), provider, network);
}

/**
 * Store a key. For Blockfrost this sets ONE network's project id and leaves the
 * other network's alone; for Koios it sets the single account-wide token and
 * `network` is ignored.
 */
export function setProviderKey(
  provider: ProviderId,
  network: NetworkName,
  key: string | null,
  homeDir?: string,
): ProviderSettings {
  const settings = readProviders(homeDir);
  const trimmed = key?.trim() ?? '';
  const value = trimmed === '' ? null : trimmed;
  if (provider === 'blockfrost') settings.keys.blockfrost[network] = value;
  else settings.keys.koios = value;
  writeProviders(settings, homeDir);
  return settings;
}

/** Remove a stored key (one network for Blockfrost, the token for Koios). */
export function clearProviderKey(
  provider: ProviderId,
  network: NetworkName,
  homeDir?: string,
): ProviderSettings {
  return setProviderKey(provider, network, null, homeDir);
}

export function setPrimary(provider: ProviderId, homeDir?: string): ProviderSettings {
  const settings = readProviders(homeDir);
  settings.primary = provider;
  if (settings.fallback === provider) settings.fallback = null;
  writeProviders(settings, homeDir);
  return settings;
}

export function setFallback(provider: ProviderId | null, homeDir?: string): ProviderSettings {
  const settings = readProviders(homeDir);
  settings.fallback = provider === settings.primary ? null : provider;
  writeProviders(settings, homeDir);
  return settings;
}

/**
 * Networks this provider holds a key for. Koios answers both networks or
 * neither, because its one token covers every host.
 */
export function configuredNetworks(provider: ProviderId, homeDir?: string): NetworkName[] {
  const settings = readProviders(homeDir);
  return (['mainnet', 'preprod'] as NetworkName[]).filter(
    (network) => keyOf(settings, provider, network) != null,
  );
}

// --- resolution (file + env) ----------------------------------------------

export interface ProviderCredentials {
  provider: ProviderId;
  /** Null means "no key" -- legitimate for Koios, fatal for Blockfrost. */
  key: string | null;
  /** True when the key came from the environment rather than the file. */
  fromEnv: boolean;
  /** Whether this provider can actually serve the network with what we have. */
  usable: boolean;
}

export interface ResolvedProviders {
  network: NetworkName;
  primary: ProviderCredentials | null;
  fallback: ProviderCredentials | null;
}

/**
 * Koios works anonymously (at a lower rate limit), so a missing token is a
 * valid configuration. Blockfrost cannot answer a single request without one.
 */
export function requiresKey(provider: ProviderId): boolean {
  return provider === 'blockfrost';
}

function envKey(provider: ProviderId, env: Env): string | null {
  const value = env[ENV_VARS[provider]];
  return value != null && value.trim() !== '' ? value.trim() : null;
}

function credentialsFor(
  provider: ProviderId,
  network: NetworkName,
  settings: ProviderSettings,
  env: Env,
): ProviderCredentials {
  // An env override applies to the ACTIVE network only and is never persisted.
  const fromEnvValue = envKey(provider, env);
  const key = fromEnvValue ?? keyOf(settings, provider, network);
  return {
    provider,
    key,
    fromEnv: fromEnvValue != null,
    usable: key != null || !requiresKey(provider),
  };
}

/**
 * Effective credentials for a network: the file, with env overrides applied.
 *
 * When the file names no primary yet, the environment may still supply one --
 * `YACOW_PROVIDER_PRIMARY`, or whichever provider has an env key set. That
 * keeps scripted/CI runs working without a setup wizard.
 */
export function resolveProviders(
  network: NetworkName,
  { homeDir, env = process.env }: ReadOptions = {},
): ResolvedProviders {
  const settings = readProviders(homeDir);
  const envPrimary = sanitiseProviderId(env[ENV_VARS.primary]);
  const implicitPrimary = PROVIDER_IDS.find((provider) => envKey(provider, env) != null) ?? null;
  const primaryId = envPrimary ?? settings.primary ?? implicitPrimary;
  const fallbackId = settings.fallback === primaryId ? null : settings.fallback;

  return {
    network,
    primary: primaryId == null ? null : credentialsFor(primaryId, network, settings, env),
    fallback: fallbackId == null ? null : credentialsFor(fallbackId, network, settings, env),
  };
}

/** Can the app talk to the chain on this network right now? (gate, decision 4.5) */
export function isConfigured(network: NetworkName, options: ReadOptions = {}): boolean {
  return resolveProviders(network, options).primary?.usable === true;
}

/**
 * The provider to suggest when the active network has no usable primary
 * (decision 4.9): the fallback, but only if IT can serve this network.
 */
export function suggestedProviderFor(
  network: NetworkName,
  options: ReadOptions = {},
): ProviderId | null {
  const { fallback } = resolveProviders(network, options);
  return fallback?.usable === true ? fallback.provider : null;
}

// --- rendering -------------------------------------------------------------

const MASK_CHAR = '*';
const VISIBLE_PREFIX = 7; // "mainnet" / "preprod" -- the useful part of a Blockfrost id
const VISIBLE_SUFFIX = 4;

/**
 * Render a key for the UI. Never returns the whole key: short keys are masked
 * completely, longer ones keep just enough to recognise which key it is.
 */
export function maskKey(key: string | null): string {
  if (key == null || key === '') return '(not set)';
  if (key.length < VISIBLE_PREFIX + VISIBLE_SUFFIX + 4) return MASK_CHAR.repeat(key.length);
  return `${key.slice(0, VISIBLE_PREFIX)}${MASK_CHAR.repeat(4)}${key.slice(-VISIBLE_SUFFIX)}`;
}
