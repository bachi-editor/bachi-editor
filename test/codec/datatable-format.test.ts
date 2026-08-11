// The save path overwrites the game's own datatable files, so re-encoding must
// reproduce their exact JSON layout — otherwise the first save reflows a 2 MB
// file and every later byte comparison against the dump is noise. The game does
// not use one style (see codec/datatable/serde.ts), so the guarantee is
// per file: decode → encode is byte-exact for every file in every dump.

import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openEnvelope } from '../../src/codec/envelope';
import {
  detectJsonTextStyle,
  detectPayloadStyle,
  encodeStyledJsonPayload,
  formatJsonText,
  MINIFIED_JSON_STYLE,
} from '../../src/codec/datatable/serde';
import { DATATABLE_KEY_HEX } from '../helpers/keys';
import { DUMPS, loadBytes } from '../helpers/dumps';

const FILES = ['musicinfo.bin', 'music_order.bin', 'wordlist.bin'] as const;

describe('JSON text style', () => {
  const sample = { items: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] };

  test('minified style round-trips through plain JSON.stringify', () => {
    expect(formatJsonText(sample, MINIFIED_JSON_STYLE)).toBe(JSON.stringify(sample));
  });

  test('detects the three layouts the corpus uses', () => {
    expect(detectJsonTextStyle('{"items":[\r\n\t{\r\n\t\t"id":"a"\r\n\t}\r\n]}\r\n')).toEqual({
      indent: '\t', eol: '\r\n', colonSpace: false, trailingEol: '\r\n', inlineRoot: true,
    });
    expect(detectJsonTextStyle('{\n\t"items": [\n\t\t{\n\t\t\t"id": "a"\n\t\t}\n\t]\n}')).toEqual({
      indent: '\t', eol: '\n', colonSpace: true, trailingEol: '', inlineRoot: false,
    });
    expect(detectJsonTextStyle('{"items":[{"id":"a"}]}')).toEqual(MINIFIED_JSON_STYLE);
  });

  test('a detected style re-renders the document it came from', () => {
    for (const text of [
      '{"items":[\r\n\t{\r\n\t\t"id":"a",\r\n\t\t"n":1\r\n\t},\r\n\t{\r\n\t\t"id":"b",\r\n\t\t"n":2\r\n\t}\r\n]}\r\n',
      '{\n\t"items": [\n\t\t{\n\t\t\t"id": "a",\n\t\t\t"n": 1\n\t\t},\n\t\t{\n\t\t\t"id": "b",\n\t\t\t"n": 2\n\t\t}\n\t]\n}',
      '{"items":[{"id":"a","n":1},{"id":"b","n":2}]}',
    ]) {
      expect(formatJsonText(JSON.parse(text), detectJsonTextStyle(text))).toBe(text);
    }
  });

  test('empty objects and arrays stay inline', () => {
    const style = detectJsonTextStyle('{"items":[\r\n\t{\r\n\t\t"id":"a"\r\n\t}\r\n]}\r\n');
    expect(formatJsonText({ items: [] }, style)).toBe('{"items":[]}\r\n');
    expect(formatJsonText({ items: [{}] }, style)).toBe('{"items":[\r\n\t{}\r\n]}\r\n');
  });
});

/**
 * CHN's musicinfo.bin is not internally consistent: 57161 of its member colons
 * are followed by a space and 150 are not, switching mid-file at the `kumaxx`
 * record — songs appended by some other tool. No single style reproduces it, so
 * re-encoding normalises those few records onto the file's dominant layout.
 * Every other file in the corpus is uniform and comes back byte for byte.
 */
const MIXED_STYLE = new Set(['CHN/musicinfo.bin']);

describe.each(DUMPS)('datatable re-encode preserves layout [$region]', ({ region, x64 }) => {
  test.each(FILES)('%s', async (name) => {
    const bytes = await loadBytes(resolve(x64, 'datatable', name));
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const original = Buffer.from(payload).toString('utf8');
    const reencoded = Buffer.from(encodeStyledJsonPayload(JSON.parse(original), detectPayloadStyle(payload)));

    if (!MIXED_STYLE.has(`${region}/${name}`)) {
      expect(reencoded.equals(Buffer.from(payload))).toBe(true);
      return;
    }
    // Content is untouched, and the normalisation settles after one pass —
    // saving twice must not keep reflowing the file.
    const text = reencoded.toString('utf8');
    expect(JSON.parse(text)).toEqual(JSON.parse(original));
    expect(Buffer.from(encodeStyledJsonPayload(JSON.parse(text), detectJsonTextStyle(text))).equals(reencoded))
      .toBe(true);
  });
});
