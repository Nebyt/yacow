import { useMemo, type ReactNode } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { qrRows } from './qrMatrix.js';
import { MUTED } from './theme.js';

/**
 * Terminal cells are about twice as tall as they are wide, so a module drawn as
 * a single cell yields a stretched, unscannable code. Two cells per module is
 * what the `qrcode` terminal renderer does, and it keeps the symbol square.
 */
const CELLS_PER_MODULE = 2;

// Fixed black-on-white: a scanner reads the rendered pixels, so these must not
// follow the terminal theme the way the rest of the UI does.
const DARK = '#000000';
const LIGHT = '#ffffff';

type QrCodeProps = {
  content: string;
  /** Rows the surrounding page chrome occupies, so we can tell whether we fit. */
  reservedRows: number;
};

/**
 * Scannable QR symbol drawn with background-coloured cells. Renders a hint
 * instead of the symbol when the terminal is too short: a clipped QR is
 * useless, and letting it overflow pushes the rest of the page off-screen.
 */
export function QrCode({ content, reservedRows }: QrCodeProps): ReactNode {
  const rows = useMemo(() => qrRows(content), [content]);
  const { height } = useTerminalDimensions();

  if (rows.length + reservedRows > height) {
    return <text fg={MUTED}>Resize to {rows.length + reservedRows} rows to see the QR code.</text>;
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows.map((runs, row) => (
        <text key={row}>
          {runs.map((run, i) => (
            <span key={i} bg={run.dark ? DARK : LIGHT}>
              {' '.repeat(run.modules * CELLS_PER_MODULE)}
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}
