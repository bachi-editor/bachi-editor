# NUS3BANK Corpus Notes (CHN v12r00)

Generated from `resources/TaikoCHN/Data/x64/sound/*.nus3bank` on 2026-08-07.

## Top-level shape

- Corpus size: 1,121 `.nus3bank` files.
- Song banks: 1,044 `song_*.nus3bank` files.
- Every file starts with `NUS3`. Most files use a little-endian size field equal to
  `fileSize - 8`. Six referenced-IDSP song banks instead use the sentinel-like bytes
  `cc cc 07 48` in that field (`song_i7poli`, `song_kamias`, `song_krseib`,
  `song_pr9del`, `song_pr9trp`, `song_umamop`); their `BANKTOC` and concrete section
  sizes still parse normally.
- Every file has the same `BANKTOC ` section order:
  `PROP`, `BINF`, `GRP `, `DTON`, `TONE`, `JUNK`, `PACK`.
- `BANKTOC ` is little-endian. Its payload starts with a section count, followed by
  `{ fourcc, u32le payloadSize }` entries. The concrete sections then appear sequentially,
  each as `{ fourcc, u32le payloadSize, payload }`.

## TONE records

- `TONE` payload starts with `u32le count`, then `count` entries of
  `{ u32le recordOffset, u32le recordSize }`, relative to the TONE payload start.
- The normal CHN tone record stores a length-prefixed NUL-terminated name at record offset `0x0c`.
  The stream descriptor starts at `0x0c + align4(1 + nameLength)`.
- The referenced `PACK` byte range is read from descriptor offsets `+0x08` and `+0x0c`:
  `{ u32le packOffset, u32le packSize }`.
- Song-select demo start (`TJA` `DEMOSTART`) is stored in the TONE record, not in
  `musicinfo.bin`. Across the 1,044 CHN `song_*.nus3bank` files, the stable rule is:
  find the `s32le -1` sentinel immediately before the stream-info sample rate (`32000`,
  `44100`, or `48000`), then read the `s32le` milliseconds value four bytes before that
  sentinel. The observed demo-start relative offsets are:
  `0xb0` (1 file), `0xb8` (1), `0xbc` (27), `0xc0` (259), and `0xc4` (756).
  Values range from `0` to `140000` ms in the CHN song corpus. TaikoSoundEditor confirms
  the same field for its generated template by writing `demostart * 1000` at template
  absolute `0x6c4`, which is record-relative `0xc4` in that template shape.
- Some non-song voice/SE banks include short or non-audio TONE records. The parser preserves those
  as `noStreamReason` instead of treating them as fatal.

## Referenced stream formats

Referenced streams across all TONE records:

| Magic | Count | Notes |
| --- | ---: | --- |
| `BNSF` | 1,601 | Main CHN bank payload format. |
| `RIFF` | 124 | Non-song `se_neiro_*` tone banks. |
| `IDSP` | 7 | Song banks: `song_i7poli`, `song_kamias`, `song_krseib`, `song_m96slm`, `song_pr9del`, `song_pr9trp`, `song_umamop`. |

Referenced streams in `song_*.nus3bank`:

| Magic | Count |
| --- | ---: |
| `BNSF` | 1,037 |
| `IDSP` | 7 |

Every `song_*.nus3bank` has exactly one TONE record and exactly one referenced stream.

## BNSF header

The embedded `BNSF` stream uses big-endian fields:

| Offset | Field |
| ---: | --- |
| `0x00` | `BNSF` magic |
| `0x04` | `u32be` declared stream size |
| `0x08` | codec magic, observed `IS22` |
| `0x0c` | format chunk magic, observed `sfmt` |
| `0x10` | `u32be` format chunk size, observed `0x14` |
| `0x14` | `u16be` flags, observed `0` |
| `0x16` | `u16be` channel count |
| `0x18` | `s32be` sample rate |
| `0x1c` | `s32be` sample count |
| `0x20` | `s32be` loop adjust, observed `0` in normal songs |
| `0x24` | `u16be` block size, observed `640` for stereo songs |
| `0x26` | `u16be` block samples, observed `960` |
| `0x28` | data chunk magic, observed `sdat` |
| `0x2c` | `u32be` data chunk size |

Observed referenced BNSF metadata:

| Channels | Sample rate | Count |
| ---: | ---: | ---: |
| 2 | 48000 | 1,106 |
| 1 | 48000 | 494 |
| 2 | 44100 | 1 |

For `IS22`, the sample data is interleaved by block. A stereo song normally has `blockSize = 640`,
`blockSamples = 960`, and `frameSizePerChannel = blockSize / channels = 320` bytes. Frame byte ranges
are therefore:

```
sdat + blockIndex * blockSize + channelIndex * frameSizePerChannel
```

All 1,601 referenced BNSF streams in the corpus have `dataSize % blockSize == 0`.

## Decoder implication

The v2 decoder path cannot assume the design prototype's `IDSP·48k` placeholder. The normal song
corpus is overwhelmingly `BNSF`/`IS22`; `IDSP` is a small song minority. Phase 6 should therefore
make BNSF/IS22 the first decoder target, while keeping IDSP as a secondary path.

The primary reference is vgmstream's `bnsf.c`: `IS22` maps to G.719/Siren22 and uses interleaved
blocks (`blockSize / channels`) with 960 decoded samples per block. Browsers do not expose G.719,
so BNSF playback accepts a compatible user-supplied G.719 WASM module stored in IndexedDB; the
production app does not bundle that binary or its reference source. The seven IDSP song banks use
the built-in narrow TypeScript decoder.

## Encoder layout

Imported audio is decoded by the browser, resampled to stereo 48 kHz PCM16,
and passed to a separately user-supplied G.719 encoder WASM. The production app
does not bundle that patent-encumbered module. Encoding uses the corpus-wide
BNSF parameters above: `IS22`, 960 samples per frame, and 320 bytes (128 kbit/s)
per channel, stored channel-by-channel inside each 640-byte stereo block.

For an existing song bank, only the selected PACK stream and its dependent
size/offset fields are changed; TONE metadata such as demo start is retained.
For a new song without a bank, the app builds a one-tone bank from the
MIT-licensed TaikoSoundEditor template, expanding its BINF and TONE names for
song ids longer than the template's original six characters.

## IDSP header

The seven referenced IDSP song banks use a Namco wrapper around standard Nintendo DSP-ADPCM channel
headers:

| Offset | Field |
| ---: | --- |
| `0x00` | `IDSP` magic |
| `0x08` | `u32be` channel count, observed `2` |
| `0x0c` | `u32be` sample rate, observed `44100` or `48000` |
| `0x10` | `u32be` sample count |
| `0x20` | `u32be` channel DSP-header offset, observed `0x40` |
| `0x24` | `u32be` channel DSP-header size, observed `0x60` |
| `0x28` | `u32be` ADPCM data offset, observed `0x100` |
| `0x2c` | `u32be` ADPCM data size per channel |

Each channel header is the standard 0x60-byte DSP header shape: sample count, nibble count,
sample rate, loop fields, current address, and 16 signed big-endian ADPCM coefficients.
Channel ADPCM data is stored contiguously per channel:

```
dataOffset + channelIndex * channelDataSize
```

`decodeIdspToPcm` implements the Nintendo DSP-ADPCM frame formula in TypeScript and returns planar
`Float32Array` PCM. It is unit-tested with synthetic frames and partial decodes over all seven
referenced IDSP song streams.
