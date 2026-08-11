// Build the TaikoLocalServer datatable bundle. The zip is meant to be unpacked
// into TaikoLocalServer/Host/wwwroot/data/datatable/ after saving game files.

import { zipSync } from 'fflate';
import {
  decodeJsonPayload,
  encodeJsonPayload,
  openEnvelope,
} from '../codec';
import { datatableKeyOf, type RawDatatables } from './datatables';
import type { ProjectRoot } from './project';
import { sealDatatable } from './write';

type DatatableDraftKey = keyof RawDatatables;

interface DraftEntry {
  bin: string;
  key: DatatableDraftKey;
}

export interface ServerBundleFile {
  path: string;
  bytes: number;
}

export interface ServerBundle {
  filename: string;
  bytes: Uint8Array;
  files: ServerBundleFile[];
}

const DRAFT_ENTRIES: DraftEntry[] = [
  { bin: 'musicinfo.bin', key: 'musicinfo' },
  { bin: 'music_order.bin', key: 'musicOrder' },
  { bin: 'wordlist.bin', key: 'wordlist' },
];

const OPTIONAL_COPY_DATATABLES = ['neiro.bin'] as const;

const encoder = new TextEncoder();

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function jsonName(binName: string): string {
  return binName.replace(/\.bin$/i, '.json');
}

async function readBytes(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function addDraftDatatable(
  zip: Record<string, Uint8Array>,
  files: ServerBundleFile[],
  binName: string,
  obj: unknown,
  keyHex: string,
): Promise<void> {
  const bin = await sealDatatable(obj, keyHex);
  const json = encodeJsonPayload(obj, 2);
  zip[binName] = bin;
  zip[jsonName(binName)] = json;
  files.push({ path: binName, bytes: bin.byteLength }, { path: jsonName(binName), bytes: json.byteLength });
}

async function addOptionalExistingDatatable(
  root: ProjectRoot | undefined,
  zip: Record<string, Uint8Array>,
  files: ServerBundleFile[],
  binName: string,
): Promise<void> {
  if (!root) return;
  try {
    const bin = await readBytes(root.datatable, binName);
    const { payload } = await openEnvelope(bin, datatableKeyOf(root));
    const decoded = decodeJsonPayload(payload);
    const json = encodeJsonPayload(decoded, 2);
    zip[binName] = bin;
    zip[jsonName(binName)] = json;
    files.push({ path: binName, bytes: bin.byteLength }, { path: jsonName(binName), bytes: json.byteLength });
  } catch {
    // Optional server-side datatables are copied only when readable and decodable.
  }
}

function readmeText(ts: string, dirty: boolean, files: ServerBundleFile[]): Uint8Array {
  const body = [
    'Bachi server bundle',
    `Generated: ${ts}`,
    '',
    'Target path:',
    'TaikoLocalServer/Host/wwwroot/data/datatable/',
    '',
    'Copy every file in this zip into the target folder, replacing existing files, then restart TaikoLocalServer.',
    dirty
      ? 'This bundle was generated from the current in-memory Bachi draft. Save the project before copying if the game files must match the server files.'
      : 'This bundle was generated from the current project datatables.',
    '',
    'Files:',
    ...files.map((f) => `- ${f.path} (${f.bytes.toLocaleString()} bytes)`),
    '',
  ].join('\n');
  return encoder.encode(body);
}

export async function buildServerBundle(
  root: ProjectRoot,
  datatables: RawDatatables,
  opts: { now?: Date; dirty?: boolean } = {},
): Promise<ServerBundle> {
  const zip: Record<string, Uint8Array> = {};
  const files: ServerBundleFile[] = [];
  const datatableKey = datatableKeyOf(root);

  for (const entry of DRAFT_ENTRIES) {
    await addDraftDatatable(zip, files, entry.bin, datatables[entry.key], datatableKey);
  }
  for (const binName of OPTIONAL_COPY_DATATABLES) {
    await addOptionalExistingDatatable(root, zip, files, binName);
  }

  const ts = stamp(opts.now);
  const readme = readmeText(ts, Boolean(opts.dirty), files);
  zip['README.txt'] = readme;
  files.push({ path: 'README.txt', bytes: readme.byteLength });

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
