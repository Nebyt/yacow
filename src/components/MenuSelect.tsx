import type { ReactNode } from 'react';
import type { SelectOption } from '@opentui/core';
import { ACCENT, FG } from './theme.js';

export interface MenuItem<T> {
  label: string;
  value: T;
}

export interface MenuSelectProps<T> {
  items: MenuItem<T>[];
  onSelect: (item: MenuItem<T>) => void;
  initialIndex?: number;
  focused?: boolean;
}

/**
 * Vertical arrow-nav list (decision 6.2). Descriptions off, and no background
 * fill of its own — the list sits on the terminal's background so it works on a
 * light theme. The current row is marked by the indicator plus the accent colour.
 */
export function MenuSelect<T>({
  items,
  onSelect,
  initialIndex = 0,
  focused = true,
}: MenuSelectProps<T>): ReactNode {
  const height = Math.min(Math.max(items.length, 1), 12);
  const options: SelectOption[] = items.map((item) => ({
    name: item.label,
    description: '',
    value: item.value,
  }));

  return (
    <select
      focused={focused}
      showDescription={false}
      showScrollIndicator={items.length > 12}
      wrapSelection
      height={height}
      selectedIndex={initialIndex}
      options={options}
      backgroundColor="transparent"
      focusedBackgroundColor="transparent"
      selectedBackgroundColor="transparent"
      textColor={FG}
      focusedTextColor={FG}
      selectedTextColor={ACCENT}
      onSelect={(_index, option) => {
        if (option == null) return;
        onSelect({ label: option.name, value: option.value as T });
      }}
    />
  );
}
