import QRCode from 'qrcode';
import { qrRows, QUIET_ZONE, type QrRun } from './qrMatrix.js';

const ADDRESS =
  'addr_test1qrr6u4s99m0aj2fq9ag5du86956c8fu7mv2gtuzl7c3uhcsuv6hm9vhl7207qs0e4pcw5ctajfk37mz43kjegxqel0wssnuquu';

/**
 * The `qrcode` terminal renderer emits one `ESC[40m`/`ESC[47m` pair per module.
 * Decoding it back into a dark/light grid gives an independent reference for
 * what we draw. It always pads with a single light module, whatever `margin`
 * says, so compare the trimmed symbol rather than the margins.
 */
async function referenceSymbol(content: string): Promise<boolean[][]> {
  const rendered = await QRCode.toString(content, { type: 'terminal' });

  const grid = rendered
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => [...line.matchAll(/\u001b\[4([07])m {2}\u001b\[0m/g)].map((m) => m[1] === '0'));

  return trimLightBorder(grid);
}

/** Drop the all-light rows and columns around a grid. */
function trimLightBorder(grid: boolean[][]): boolean[][] {
  const dark = (row: boolean[]): boolean => row.some(Boolean);
  const top = grid.findIndex(dark);
  const bottom = grid.length - [...grid].reverse().findIndex(dark);
  const rows = grid.slice(top, bottom);

  const left = Math.min(...rows.map((row) => row.indexOf(true)));
  const right = Math.max(...rows.map((row) => row.lastIndexOf(true))) + 1;

  return rows.map((row) => row.slice(left, right));
}

/** Runs back to one boolean per module, for comparison with the reference. */
function expand(runs: QrRun[]): boolean[] {
  return runs.flatMap((run) => Array.from({ length: run.modules }, () => run.dark));
}

describe('qrRows', () => {
  it('matches the reference terminal renderer module for module', async () => {
    const reference = await referenceSymbol(ADDRESS);
    const symbol = trimLightBorder(qrRows(ADDRESS).map(expand));

    expect(reference.length).toBeGreaterThan(0);
    expect(symbol).toEqual(reference);
  });

  it('is square once the quiet zone is included', () => {
    const rows = qrRows(ADDRESS);

    expect(rows[0]).toHaveLength(1);
    expect(expand(rows[0])).toHaveLength(rows.length);
  });

  it('surrounds the symbol with the spec minimum quiet zone', () => {
    const rows = qrRows(ADDRESS).map(expand);
    const light = (row: boolean[]): boolean => row.every((dark) => !dark);

    expect(rows.slice(0, QUIET_ZONE).every(light)).toBe(true);
    expect(rows.slice(-QUIET_ZONE).every(light)).toBe(true);
    for (const row of rows) {
      expect(row.slice(0, QUIET_ZONE).some(Boolean)).toBe(false);
      expect(row.slice(-QUIET_ZONE).some(Boolean)).toBe(false);
    }
  });

  it('is deterministic for the same address', () => {
    expect(qrRows(ADDRESS)).toEqual(qrRows(ADDRESS));
  });

  it('rejects content that cannot be encoded', () => {
    expect(() => qrRows('x'.repeat(5000))).toThrow();
  });
});
