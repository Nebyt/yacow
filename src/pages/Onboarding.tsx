import { useRenderer } from '@opentui/react';
import type { ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { MenuSelect } from '../components/MenuSelect.js';
import { PageHeading } from '../components/Page.js';

interface Item {
  label: string;
  value: 'create' | 'restore' | 'network' | 'quit';
}

const ITEMS: Item[] = [
  { label: 'Create a new wallet', value: 'create' },
  { label: 'Restore an existing wallet', value: 'restore' },
  { label: 'Switch network', value: 'network' },
  { label: 'Quit', value: 'quit' },
];

/** First-run menu (plan §3 Op 1). Arrow-navigable (backlog #5). */
export function Onboarding(): ReactNode {
  const renderer = useRenderer();
  const { setRoute } = useStore();

  const onSelect = (item: Item) => {
    if (item.value === 'quit') {
      renderer.destroy();
      return;
    }
    setRoute(item.value);
  };

  return (
    <box flexDirection="column">
      <PageHeading
        title="Welcome to YACOW"
        subtitle="Use ↑/↓ and Enter, or the shortcut keys below."
      />
      <box marginTop={1}>
        <MenuSelect items={ITEMS} onSelect={onSelect} />
      </box>
    </box>
  );
}
