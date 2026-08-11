import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { verifyEncoderSelfConsistent } from '../../src/codec';
import { validateFumenChart } from '../../src/model/fumenValidation';
import { convertTjaForImport, decodeTjaBytes } from '../../src/model/tjaImport';
import { HAS_TJA_CORPUS } from '../helpers/resources';

const ESE_ROOT = fileURLToPath(new URL('../../../resources/ese/', import.meta.url));

async function tjaFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return tjaFiles(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.tja') ? [path] : [];
  }));
  return nested.flat().sort();
}

describe.skipIf(!HAS_TJA_CORPUS)('ESE TJA import corpus', () => {
  test('every TJA parses into saveable official fumen binaries', async () => {
    const files = await tjaFiles(ESE_ROOT);
    expect(files.length).toBeGreaterThan(3_000);

    const failures: string[] = [];
    for (const file of files) {
      try {
        const imported = convertTjaForImport(decodeTjaBytes(await readFile(file)));
        expect(imported.charts.length).toBeGreaterThan(0);
        const lossy = imported.warnings.filter((warning) =>
          warning.code === 'ignored-command'
          || warning.code === 'invalid-note'
          || warning.code === 'invalid-value');
        if (lossy.length > 0) {
          throw new Error(lossy.map((warning) =>
            `${warning.code}${warning.detail ? ` (${warning.detail})` : ''} ×${warning.count}`).join('; '));
        }
        for (const chart of imported.charts) {
          const label = file.slice(ESE_ROOT.length);
          const errors = validateFumenChart(label, chart.fumen)
            .filter((issue) => issue.level === 'error');
          if (errors.length > 0) throw new Error(errors.map((issue) => issue.message).join('; '));
          if (!verifyEncoderSelfConsistent(chart.fumen).ok) {
            throw new Error(`${chart.slot.difficulty}/${chart.slot.player} failed encoder self-check`);
          }
        }
      } catch (error) {
        failures.push(`${file.slice(ESE_ROOT.length)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures, failures.slice(0, 30).join('\n')).toEqual([]);
  }, 300_000);
});
