import React from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { useStore } from '../state/store.js';

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
export function Onboarding(): React.ReactElement {
  const { exit } = useApp();
  const { setRoute } = useStore();

  const onSelect = (item: Item) => {
    if (item.value === 'quit') {
      exit();
      return;
    }
    setRoute(item.value);
  };

  return (
    <Box flexDirection="column">
      <Text bold>Welcome to YACOW</Text>
      <Text color="gray">Use ↑/↓ and Enter, or the shortcut keys below.</Text>
      <Box marginTop={1}>
        <SelectInput items={ITEMS} onSelect={onSelect} />
      </Box>
    </Box>
  );
}
