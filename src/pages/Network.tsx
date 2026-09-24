import type { ReactNode } from 'react';
import { NETWORKS, type NetworkName } from '../config/networks.js';
import { setNetworkSetting } from '../config/settings.js';
import { isConfigured } from '../config/providers.js';
import { routeAfterNetworkSwitch } from '../state/routing.js';
import { useStore } from '../state/store.js';
import { MenuSelect, type MenuItem } from '../components/MenuSelect.js';
import { PageHeading } from '../components/Page.js';

/** Network switch (plan §3 Op 0). Arrow-select + Enter applies + persists (backlog #8). */
export function Network(): ReactNode {
  const { network, setNetwork, setRoute, activeWallet } = useStore();
  const names = Object.keys(NETWORKS) as NetworkName[];

  const items: MenuItem<NetworkName>[] = names.map((name) => ({
    label: `${NETWORKS[name].displayName}${name === network ? '  (current)' : ''}`,
    value: name,
  }));
  const initialIndex = Math.max(0, names.indexOf(network));

  const onSelect = (item: MenuItem<NetworkName>) => {
    setNetwork(item.value);
    try {
      setNetworkSetting(item.value);
    } catch {
      // non-fatal: persisting the preference failed; keep the in-memory choice
    }
    // A wallet is network-agnostic, so switching the network keeps the same
    // active wallet — its addresses/balance are simply re-derived for the new
    // network. Keys are per network though (decision 4.8): if this chain has no
    // provider yet, offer to add one instead of showing an empty dashboard.
    setRoute(
      routeAfterNetworkSwitch({
        providerConfigured: isConfigured(item.value),
        hasWallet: activeWallet != null,
      }),
    );
  };

  return (
    <box flexDirection="column">
      <PageHeading title="Network" subtitle="Choose the active network (↑/↓, Enter):" />
      <box marginTop={1}>
        <MenuSelect items={items} initialIndex={initialIndex} onSelect={onSelect} />
      </box>
    </box>
  );
}
