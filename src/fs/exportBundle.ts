// Build the TaikoLocalServer data bundle.
//
// The zip mirrors TaikoLocalServer/Host/wwwroot/data/, so unpacking it there
// puts every file where the server already looks: the game datatables under
// `datatable/`, the Dani Dojo configs at the root beside it. What goes in is the
// user's choice (see ui/ExportDialog) — any non-empty subset of the four
// server-facing data sets, each of which the editor may or may not have data for.
//
// The two formats are alternatives, not halves of one export: the server reads a
// datatable's `.json` sibling in preference to its `.bin`, so either alone is
// complete. `bin` is what the game itself reads (AES+gzip, re-emitted in the
// exact JSON layout the file already has on disk, so it matches byte for byte
// what a Bachi save writes); `json` is the same data as indented plaintext for a
// human to read or hand-edit. The Dani Dojo configs are plaintext JSON on the
// server either way — they have no encrypted form.

import { zipSync } from 'fflate';
import { encodeJsonPayload, serializeDanConfig, type DanConfig } from '../codec';
import type { DatatableName } from '../model/diff';
import { datatableKeyOf, type RawDatatables } from './datatables';
import type { ProjectRoot } from './project';
import { datatableStyleOnDisk, sealDatatable } from './write';

/** Where a bundle's contents belong. Shown in the dialog and the README. */
export const SERVER_DATA_PATH = 'TaikoLocalServer/Host/wwwroot/data/';

/** The independently-selectable data sets a bundle can carry. */
export type ServerBundlePart = 'musicMetadata' | 'musicOrder' | 'dan' | 'gaiden';

export const SERVER_BUNDLE_PARTS: readonly ServerBundlePart[] = [
  'musicMetadata',
  'musicOrder',
  'dan',
  'gaiden',
];

/** `bin`: sealed as the game reads it · `json`: indented plaintext. */
export type ServerBundleFormat = 'bin' | 'json';

export type ServerBundleSelection = Record<ServerBundlePart, boolean>;

export interface ServerBundleFile {
  path: string;
  bytes: number;
}

export interface ServerBundle {
  filename: string;
  bytes: Uint8Array;
  files: ServerBundleFile[];
}

/**
 * What a bundle is built from. Every source is optional and independent: the
 * game project (open in the editor) backs the two datatable parts, and each dani
 * file slot backs one dan part. A part selected without its source is skipped.
 */
export interface ServerBundleSources {
  project?: { root: ProjectRoot; datatables: RawDatatables };
  dan?: DanConfig;
  gaiden?: DanConfig;
}

export interface ServerBundleRequest {
  format: ServerBundleFormat;
  parts: ServerBundleSelection;
  sources: ServerBundleSources;
  now?: Date;
  /** True when the selection includes edits not yet saved to disk (README note). */
  dirty?: boolean;
}

/** The datatable files each project-backed part owns. */
const DATATABLE_FILES = {
  musicMetadata: [
    { name: 'musicinfo.bin', key: 'musicinfo' },
    { name: 'wordlist.bin', key: 'wordlist' },
    { name: 'music_attribute.bin', key: 'musicAttribute' },
    { name: 'music_usbsetting.bin', key: 'musicUsbSetting' },
    { name: 'music_ai_section.bin', key: 'musicAiSection' },
  ],
  musicOrder: [{ name: 'music_order.bin', key: 'musicOrder' }],
} as const satisfies Record<string, readonly { name: DatatableName; key: keyof RawDatatables }[]>;

/** The dani config file each dan part owns — plaintext JSON at the data root. */
const DAN_FILES = { dan: 'dan_data.json', gaiden: 'gaiden_data.json' } as const;

const DATATABLE_DIR = 'datatable';

const encoder = new TextEncoder();

function isDanPart(part: ServerBundlePart): part is 'dan' | 'gaiden' {
  return part === 'dan' || part === 'gaiden';
}

function jsonName(binName: string): string {
  return binName.replace(/\.bin$/i, '.json');
}

/**
 * The paths a part contributes, so the dialog can list exactly what the build
 * will write rather than a hand-kept copy of it.
 */
export function serverBundlePaths(part: ServerBundlePart, format: ServerBundleFormat): string[] {
  if (isDanPart(part)) return [DAN_FILES[part]];
  return DATATABLE_FILES[part].map(
    (f) => `${DATATABLE_DIR}/${format === 'bin' ? f.name : jsonName(f.name)}`,
  );
}

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readmeText(
  ts: string,
  format: ServerBundleFormat,
  dirty: boolean,
  files: ServerBundleFile[],
): Uint8Array {
  const body = [
    'Bachi server bundle',
    `Generated: ${ts}`,
    `Format: ${format === 'bin' ? 'official .bin (encrypted, as the game reads it)' : 'plaintext .json (indented)'}`,
    '',
    'Target path:',
    SERVER_DATA_PATH,
    '',
    'This zip mirrors that folder. Unpack it there keeping the folder structure —',
    'datatable files go in datatable/, dani configs sit at the root — replacing',
    'existing files, then restart TaikoLocalServer.',
    '',
    format === 'json'
      ? 'The server prefers a datatable\'s .json sibling over its .bin, so these files take effect as they are. Remove them again to fall back to the .bin files already on the server.'
      : 'These are the same bytes the game itself reads.',
    dirty
      ? 'Some of this bundle came from unsaved Bachi drafts. Save the project and/or dani files before copying if the files on disk must match this bundle.'
      : 'This bundle matches what is currently loaded in Bachi.',
    '',
    'Files:',
    ...files.map((f) => `- ${f.path} (${f.bytes.toLocaleString()} bytes)`),
    '',
  ].join('\n');
  return encoder.encode(body);
}

export async function buildServerBundle(req: ServerBundleRequest): Promise<ServerBundle> {
  const zip: Record<string, Uint8Array> = {};
  const files: ServerBundleFile[] = [];
  const add = (path: string, bytes: Uint8Array) => {
    zip[path] = bytes;
    files.push({ path, bytes: bytes.byteLength });
  };

  const { project } = req.sources;
  if (project) {
    // Plain JSON needs no game key; sealed .bin output resolves it once for the
    // whole run.
    const keyHex = req.format === 'bin' ? datatableKeyOf(project.root) : undefined;
    for (const part of ['musicMetadata', 'musicOrder'] as const) {
      if (!req.parts[part]) continue;
      for (const file of DATATABLE_FILES[part]) {
        const obj = project.datatables[file.key];
        if (!obj) {
          throw new Error(`Cannot export ${file.name}: the table was not loaded from this project.`);
        }
        if (req.format === 'bin') {
          const style = await datatableStyleOnDisk(project.root, file.name, keyHex!);
          add(`${DATATABLE_DIR}/${file.name}`, await sealDatatable(obj, keyHex!, style));
        } else {
          add(`${DATATABLE_DIR}/${jsonName(file.name)}`, encodeJsonPayload(obj, 2));
        }
      }
    }
  }

  for (const part of ['dan', 'gaiden'] as const) {
    const config = req.sources[part];
    if (!req.parts[part] || !config) continue;
    add(DAN_FILES[part], encoder.encode(serializeDanConfig(config)));
  }

  if (files.length === 0) {
    throw new Error('Nothing was selected to export.');
  }

  const ts = stamp(req.now);
  add('README.txt', readmeText(ts, req.format, Boolean(req.dirty), [...files]));

  return {
    filename: `bachi-server-bundle-${ts}.zip`,
    bytes: zipSync(zip, { level: 6 }),
    files,
  };
}

export function downloadServerBundle(bundle: ServerBundle): void {
  const blob = new Blob([bundle.bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bundle.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
