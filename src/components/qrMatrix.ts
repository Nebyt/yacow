// Row model for the Receive QR. Kept free of JSX so it can be unit-tested
// against the `qrcode` package's own terminal renderer, which is the reference
// for "a scanner can read this".
import QRCode from 'qrcode';

/** The QR spec's minimum margin; scanners need it to find the symbol. */
export const QUIET_ZONE = 4;

/** A horizontal stretch of same-coloured modules. */
export type QrRun = { dark: boolean; modules: number };

function appendRun(runs: QrRun[], dark: boolean, modules: number): void {
  const last = runs[runs.length - 1];
  if (last?.dark === dark) last.modules += modules;
  else runs.push({ dark, modules });
}

/**
 * The symbol as colour runs per row, quiet zone included. Row indices run over
 * the padded symbol, so rows outside the matrix are all-light margin.
 */
export function qrRows(content: string): QrRun[][] {
  const { size, data } = QRCode.create(content, {}).modules;

  return Array.from({ length: size + QUIET_ZONE * 2 }, (_, padded) => {
    const row = padded - QUIET_ZONE;
    const runs: QrRun[] = [];

    appendRun(runs, false, QUIET_ZONE);
    if (row >= 0 && row < size) {
      for (let col = 0; col < size; col++) appendRun(runs, data[row * size + col] === 1, 1);
    } else {
      appendRun(runs, false, size);
    }
    appendRun(runs, false, QUIET_ZONE);

    return runs;
  });
}
