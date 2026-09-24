import type { ReactNode } from 'react';
import type { InputProps } from '@opentui/react';
import { TextInput } from './TextInput.js';
import { FG } from './theme.js';

export interface LabeledTextInputProps extends InputProps {
  label: string;
  /** Fill the row after the label instead of using the input's intrinsic width. */
  fill?: boolean;
}

/** A stable label/input row with theme-aware text and cursor colours. */
export function LabeledTextInput({
  label,
  fill = false,
  ...inputProps
}: LabeledTextInputProps): ReactNode {
  return (
    <box flexDirection="row" width={fill ? '100%' : 'auto'}>
      <text fg={FG} flexShrink={0}>
        {label}:{' '}
      </text>
      <TextInput
        flexGrow={fill ? 1 : inputProps.flexGrow}
        flexBasis={fill ? 0 : inputProps.flexBasis}
        {...inputProps}
      />
    </box>
  );
}
