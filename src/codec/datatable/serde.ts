// Datatable JSON ↔ bytes helpers. The on-disk files are gzip+AES-wrapped UTF-8
// JSON text. The envelope is handled in codec/envelope.ts; this module just
// converts between Uint8Array (UTF-8 JSON text) and JS objects, preserving
// formatting where possible.
//
// The game's serialiser does not write one house style — the corpus has three:
//
//   CHN musicinfo/music_order  {\n\t"items": [\n\t\t{\n\t\t\t"id": "10jiku",…
//   CHN wordlist               {"items":[{"key":"copyright_01",…            (minified)
//   JPN 39.06 (all three)      {"items":[\r\n\t{\r\n\t\t"id":"10jiku",…     (+ trailing CRLF)
//
// So "preserve the formatting" can only mean per file: detect the layout when
// reading and re-emit it when writing, which is what JsonTextStyle carries.
// datatable-format.test.ts holds the guarantee — for every file in every dump,
// decode → encode reproduces the payload byte for byte.

import { GenericDatatableFile } from './types';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export interface JsonTextStyle {
  /** One level of indent, or '' when the file is written on a single line. */
  indent: string;
  /** Line terminator between members, or '' when minified. */
  eol: string;
  /** Whether a space follows the `:` of a member. */
  colonSpace: boolean;
  /** Terminator after the final `}`, or '' when the file ends without one. */
  trailingEol: string;
  /**
   * True when the root object is written inline (`{"items":[`) so it costs no
   * indent level and its array starts one level in. A stock pretty-printer
   * breaks after the opening `{` instead; JPN 39.06 does not.
   */
  inlineRoot: boolean;
}

/** `JSON.stringify(obj)` — no whitespace anywhere. */
export const MINIFIED_JSON_STYLE: JsonTextStyle = {
  indent: '',
  eol: '',
  colonSpace: false,
  trailingEol: '',
  inlineRoot: true,
};

/** Index of the first `:` that is structure rather than string content. */
function firstStructuralColon(text: string): number {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === ':') return i;
  }
  return -1;
}

/** Read back the layout of an existing datatable JSON document. */
export function detectJsonTextStyle(text: string): JsonTextStyle {
  const trailingEol = text.endsWith('\r\n') ? '\r\n' : text.endsWith('\n') ? '\n' : '';
  const body = trailingEol ? text.slice(0, -trailingEol.length) : text;
  const eol = body.includes('\r\n') ? '\r\n' : body.includes('\n') ? '\n' : '';
  let indent = '';
  if (eol !== '') {
    const afterFirstBreak = body.slice(body.indexOf(eol) + eol.length);
    indent = /^[\t ]+/.exec(afterFirstBreak)?.[0] ?? '';
  }
  const colon = firstStructuralColon(body);
  return {
    indent,
    eol,
    colonSpace: colon >= 0 && body[colon + 1] === ' ',
    trailingEol,
    inlineRoot: eol === '' || !body.startsWith('{' + eol),
  };
}

/** Layout of the JSON document in `payload`. */
export function detectPayloadStyle(payload: Uint8Array): JsonTextStyle {
  return detectJsonTextStyle(decoder.decode(payload));
}

/** Indent for nesting level `d`. Minified styles carry no indent or eol. */
function pad(s: JsonTextStyle, d: number): string {
  return s.indent.repeat(d);
}

function writeValue(value: unknown, depth: number, s: JsonTextStyle, out: string[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) { out.push('[]'); return; }
    out.push('[', s.eol);
    value.forEach((item, i) => {
      out.push(pad(s, depth + 1));
      writeValue(item, depth + 1, s, out);
      out.push(i === value.length - 1 ? '' : ',', s.eol);
    });
    out.push(pad(s, depth), ']');
    return;
  }
  if (value !== null && typeof value === 'object') {
    writeObject(value as Record<string, unknown>, depth, s, out, false);
    return;
  }
  out.push(JSON.stringify(value ?? null));
}

function writeObject(
  obj: Record<string, unknown>,
  depth: number,
  s: JsonTextStyle,
  out: string[],
  inline: boolean,
): void {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) { out.push('{}'); return; }
  // An inline object keeps its members on the opening line and spends no indent
  // level, so a nested array still breaks at `depth`, not `depth + 1`.
  const eol = inline ? '' : s.eol;
  const memberDepth = inline ? depth : depth + 1;
  out.push('{', eol);
  entries.forEach(([key, value], i) => {
    out.push(inline ? '' : pad(s, memberDepth));
    out.push(JSON.stringify(key), ':', s.colonSpace ? ' ' : '');
    writeValue(value, memberDepth, s, out);
    out.push(i === entries.length - 1 ? '' : ',', eol);
  });
  out.push(inline ? '' : pad(s, depth), '}');
}

/** Render `obj` as JSON text laid out in `style`. */
export function formatJsonText(obj: unknown, style: JsonTextStyle): string {
  const out: string[] = [];
  // `inlineRoot` describes the document's root object, so it applies here only.
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    writeObject(obj as Record<string, unknown>, 0, style, out, style.inlineRoot);
  } else {
    writeValue(obj, 0, style, out);
  }
  return out.join('') + style.trailingEol;
}

export function decodeJsonPayload<T = GenericDatatableFile>(payload: Uint8Array): T {
  const text = decoder.decode(payload);
  return JSON.parse(text) as T;
}

/** Encode JS object → UTF-8 JSON bytes. Uses no indentation (compact) by default. */
export function encodeJsonPayload(obj: unknown, indent: number | undefined = undefined): Uint8Array {
  const text = JSON.stringify(obj, null, indent);
  return encoder.encode(text);
}

/** Encode JS object → UTF-8 JSON bytes, reproducing an existing file's layout. */
export function encodeStyledJsonPayload(obj: unknown, style: JsonTextStyle): Uint8Array {
  return encoder.encode(formatJsonText(obj, style));
}
