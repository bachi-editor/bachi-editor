# CHN `v12r00_cn` fumen binary format

Reverse-engineered against the real corpus under
`resources/TaikoCHN/Data/x64/fumen/` and cross-validated against
[tja2fumen](https://github.com/vivaria/tja2fumen) (MIT). The whole file is
`gzip` then `AES-256-CBC` (the standard CHN envelope); this document describes
the **decrypted, decompressed payload** that `decode.ts` / `encode.ts` operate
on.

> **Round-trip contract.** `decode → encode` is byte-identical for every file in
> the corpus (Phase 0 full-corpus test, 15,075 files). Fields we understand are
> typed; every other byte is preserved verbatim (header tail, reserved padding,
> the drumroll suffix). Nothing in editable space is silently dropped.

## Layout

```
payload
├── header            520 bytes, typed FumenHeader (decodeHeader/encodeHeader)
├── measure[0]        measure header (40) + 3 × branch
├── measure[1]
│   …
├── measure[N-1]      N = header.measureCount (byte 512, i32 LE)
└── trailer           any bytes after the last measure, preserved verbatim
```

All multi-byte fields are **little-endian**.

### Header — 520 bytes (`FUMEN_HEADER_SIZE`)

Decoded into a typed `FumenHeader` struct (`header.ts`, `decodeHeader` /
`encodeHeader`). Mapped against tja2fumen's `FumenHeader` and confirmed
field-by-field against the CHN `v12r00_cn` corpus (Phase 8.4 probe). The struct
covers **all 520 bytes** — there is no opaque tail — and `decode → encode` is
byte-perfect on every one of the 15,075 corpus charts
(`test/codec/fumen-header.test.ts`).

The header is two regions: a 432-byte block of f32 timing windows, then 22 i32
fields.

| Bytes   | Field (struct key)            | Type     | Notes |
|---------|-------------------------------|----------|-------|
| 0..431  | `timingWindows`               | f32 × 108 | 36 identical `(良/GOOD, 可/OK, 不可/BAD)` hit-window triples in ms, keyed by difficulty — see "Timing windows" below |
| 432     | `hasBranches`                 | i32      | stored branch flag, 0/1 — **not** derivable from notes (see below) |
| 436     | `hpMax`                       | i32      | soul-gauge max — corpus: always **10000** |
| 440     | `hpClear`                     | i32      | gauge needed to clear — corpus: 6000/7000/8000 |
| 444     | `hpGainGood`                  | i32      | gauge gain on a GOOD hit |
| 448     | `hpGainOk`                    | i32      | gauge gain on an OK hit |
| 452     | `hpLossBad`                   | i32      | gauge loss on a BAD hit (negative) |
| 456     | `normalNormalRatio`           | i32      | score ratio — corpus: always **65536** |
| 460     | `normalProfessionalRatio`     | i32      | branch score ratio |
| 464     | `normalMasterRatio`           | i32      | branch score ratio |
| 468     | `branchPtsGood`               | i32      | branch points for a GOOD hit |
| 472     | `branchPtsOk`                 | i32      | branch points for an OK hit |
| 476     | `branchPtsBad`                | i32      | branch points for a BAD hit (corpus: 0) |
| 480     | `branchPtsDrumroll`           | i32      | branch points per drumroll hit |
| 484     | `branchPtsGoodBig`            | i32      | branch points for a big-note GOOD |
| 488     | `branchPtsOkBig`              | i32      | branch points for a big-note OK |
| 492     | `branchPtsDrumrollBig`        | i32      | branch points per big-drumroll hit |
| 496     | `branchPtsBalloon`            | i32      | branch points per balloon hit |
| 500     | `branchPtsKusudama`           | i32      | branch points per kusudama hit |
| 504     | `branchPtsUnknown`            | i32      | reserved branch-points field (corpus: 0/20) |
| 508     | `dummyData`                   | i32      | legacy 旧配点 (pre-Shinuchi) theoretical max score of the master branch — **derived**, see "Scoring model" below |
| 512     | `measureCount`                | i32      | number of measures that follow |
| 516     | `unknownData`                 | i32      | reserved — corpus: **0** in all 15,075 files, preserved verbatim |

**`hasBranches` is an independent persisted flag, not a derived marker.** The
Phase 8.4 probe found **39 corpus charts** where it disagrees with branch-note
presence — e.g. `dondo_n` has 168 notes across its E/M tracks but `hasBranches=0`,
and `medl22_m` / `ryuhim_e`/`ryuhim_h` carry branch data with the flag off. So the
editor stores/edits it directly rather than computing it. Phase 8.5 exposes it in
the Chart properties drawer; flipping it on makes the canvas render three staves
(via `model/fumenEdits.ts:fumenIsBranched` = flag OR E/M notes) so a flat chart can
be turned into a branched one — the standing Phase 3.5 gap, now closed.

`dummyData` (508) is a **derived** value (the master branch's legacy-scoring
theoretical max — see "Scoring model"), not free data; `unknownData` (516) is
reserved and 0 in every corpus file. Both round-trip verbatim. Everything else is
a typed, editable field.

### Timing windows — bytes 0..431

The 432-byte float block is **36 identical copies** of one 3-float triple
`(良 GOOD, 可 OK, 不可 BAD)` — the hit-judgement half-windows in **milliseconds**
(a hit within ±GOOD ms of the note scores 良, within ±OK scores 可, within ±BAD
is 不可/miss-but-registered). Every value is a **half-frame multiple at the NTSC
59.94 Hz frame rate** (1 frame = 1000/59.94 ≈ 16.6833 ms). The corpus uses exactly
three profiles, keyed only by difficulty (this matches tja2fumen's
`set_timing_windows`, which writes `TIMING_WINDOWS[difficulty] * 36`):

| Profile          | Difficulties        | GOOD / OK / BAD (ms)              | in frames        | Files |
|------------------|---------------------|-----------------------------------|------------------|-------|
| strict           | Hard, Oni, Ura      | 25.025 / 75.075 / 108.4417        | 1.5 / 4.5 / 6.5  | 7,845 |
| lenient          | Easy, Normal        | 41.7083 / 108.4417 / 125.125      | 2.5 / 6.5 / 7.5  | 6,786 |
| lenient-wide     | some Easy (1★)      | 41.7083 / 125.125 / 125.125       | 2.5 / 7.5 / 7.5  | 444   |

Exact f32 bit patterns (u32 LE): GOOD strict `0x41c83334`, OK strict `0x42962667`,
BAD strict / OK lenient `0x42d8e222`, GOOD lenient `0x4226d556`, BAD lenient / wide
`0x42fa4000`. When authoring a new chart, fill all 108 floats with the difficulty's
triple; default Easy to the plain *lenient* profile (the *lenient-wide* variant is
only used by the easiest Easy charts).

The **sole exception** to "36 identical triples" is the `wii5op` medley (12 files,
the same song that owns every `SPECIAL_NOTE_TYPES` id): being a multi-song medley it
switches window profile partway through, so its 36 triples are not all equal. No
other corpus chart varies within its 108 floats.

### Measure header — 40 bytes (`FUMEN_MEASURE_HEADER_SIZE`)

| Field        | Type   | Bytes | Notes |
|--------------|--------|-------|-------|
| `bpm`        | f32    | 4     | tempo for this measure |
| `offset`     | f32    | 4     | ms delay/offset (first measure ≈ chart offset) |
| `gogo`       | u8     | 1     | 0/1 go-go time |
| `barline`    | u8     | 1     | 0/1 draw the barline |
| `padding1`   | u16    | 2     | **reserved, always 0** (see below) |
| `branchInfo` | i32×6  | 24    | branch-transition thresholds `[N→E, N→M, E→E, E→M, M→E, M→M]`; `[-1×6]` ⇒ not a branch point |
| `padding2`   | i32    | 4     | **reserved, always 0** |

Then 3 branches follow (Normal, Expert/Professional, Master), always all three.

**`branchInfo`** carries, per branch-decision measure, the score/accuracy needed to
enter Expert or Master from each current branch (Normal / Expert / Master). Corpus
observation (1,173 branch-decision measures): the pair for each source branch is
ordered `→E ≤ →M`, and the magnitude reveals the branch *condition type* — small
integers like `[1,2,1,2,1,2]` are **drumroll-count** branches (hit 1 roll → Expert,
2 → Master), while values in the hundreds (`[300,400,…]`) are **accuracy/precision**
branches (a scaled good/ok tally over the judge section). `[-1,-1,-1,-1,-1,-1]` marks
a measure that is not a branch point. Authoring flat (non-branched) charts writes
`[-1×6]` on every measure; full branch authoring is a later feature.

### Branch header — 8 bytes (`FUMEN_BRANCH_HEADER_SIZE`)

| Field         | Type | Bytes | Notes |
|---------------|------|-------|-------|
| `totalNotes`  | u16  | 2     | note count (written from `notes.length` on encode) |
| `padding`     | u16  | 2     | **reserved, always 0** |
| `speed`       | f32  | 4     | scroll multiplier (HS) for this branch |

Then `totalNotes` note records.

### Note record — 24 bytes (`FUMEN_NOTE_SIZE`) + optional 8-byte suffix

| Field       | Type | Bytes | Notes |
|-------------|------|-------|-------|
| `type`      | i32  | 4     | note-type id (see below) |
| `position`  | f32  | 4     | ms within the measure |
| `item`      | i32  | 4     | note flag, **0 or 1** (1 on 5,655 tap notes across 107 songs; meaning unconfirmed — author as 0) |
| `padding`   | f32  | 4     | **reserved, always 0** |
| `scoreInit` | u16  | 2     | 初項 — legacy base score per note (uniform per chart); balloon/kusudama hit count for `0xa`/`0xc` |
| `scoreDiff` | u16  | 2     | 公差 — legacy per-10-combo score increment (uniform per chart); **not** always 0 (see "Scoring model") |
| `duration`  | f32  | 4     | ms length for drumrolls/balloons; 0 for tap notes |

> **Correction.** Earlier notes here claimed `scoreDiff` "always 0 in the corpus".
> That is wrong: it is nonzero on **5,676,330** of 5,720,243 notes — it is the 公差
> (common difference) of the legacy arithmetic-progression scoring, paired with
> `scoreInit` (初項). Both are uniform within a chart. They are zero only where they
> are unused: on balloon/kusudama notes (whose `scoreInit` holds the hit count and
> `scoreDiff` is 0) and drumroll notes.

A drumroll note's `scoreInit` holds the chart's base score (初項), same as a tap —
but it is excluded from the score ceiling (`scoreDiff` is 0 on it, and rolls don't
count toward the max; see "Scoring model"). Its `duration` is the roll length in ms.

Drumroll-type notes (`0x6`, `0x9`) carry **8 extra reserved bytes**
(`FUMEN_DRUMROLL_SUFFIX_SIZE`) after the 24-byte record. **Always all-zero**
across the corpus (see below). `encode.ts` preserves a decoded suffix verbatim
and synthesizes zeros for a hand-built note that omits it.

### Note-type ids

Named in `FUMEN_NOTE_TYPE_NAMES` (`types.ts`): `0x1` Don … `0xc` Kusudama,
and `0xd` KA2.

**Small-note sound variants** — `0x2`/`0x3` (Don2/Don3) and `0x5` (Ka2) render
identically to a primary small **Don / Ka** (red / blue) but differ in the hit
*sound* the game plays, so consecutive same-colour notes don't sound robotic
(exactly like a TJA's `n`/`d`/`k` sound letters). The game shows distinct kana for
each: `0x1` ドン / `0x2` ド / `0x3` コ, and `0x4` カ / `0x5` カッ.

**Both-players (双人 / 2P co-op) big notes** — `0xb` (DON2) and `0xd` (KA2) are **not**
a sound variant, and **not** a "both-hands"/hard-hit note (arcade drums are
force-sensitive — there is no two-stick distinction like the console games). They are
**two-player co-op notes**: in 2-player mode both players must hit them together for the
co-op bonus. They render and sound *exactly* like the ordinary big Don/Ka `0x7`/`0x8` —
same big red/blue note, same hit sound, and the game shows the **same** kana `ドン(大)` /
`カッ(大)` (the tell: a sound variant would show different kana, like the small notes do).

Evidence:
- **Corpus alignment** — the fumen ships three per chart: `<song>_<diff>.bin` (solo) plus
  `_1`/`_2` (the two players' co-op charts). Across all 62 co-op charts whose `_1`/`_2`
  genuinely differ and contain these ids, **100%** of player 1's `0xb`/`0xd` notes fall at
  the same time as a note in player 2's chart, and **99%** at the same `0xb`/`0xd` —
  i.e. both players strike them simultaneously. (Full-corpus census: `0xb` 23,737 notes /
  2,802 files, `0xd` 9,227 / 1,260; and they essentially never overlay a `0x7`/`0x8` in the
  same chart — only 15 of ~33k.)
- **The binary** — `Taiko.exe` (`FumenMan`) has a `ReplaceOnpuForSinglePlayer` routine that
  swaps these for an ordinary big note when only one player is present.
- **Heritage** — they come from TJA notes `A`/`B`; tja2fumen labels the id "hands" from the
  older console "両手/double" notes, but in this arcade title the id is reused for 2P co-op
  (`tja-tools` documents `A`/`B` as 双人 = *two-player*).

They are **not** a purple "kadon". The editor draws them red/big and blue/big like
`0x7`/`0x8`, and the Type dropdown labels them `ドン(大) Big Don · both-players` /
`カッ(大) Big Ka · both-players`.

All 13 named types are authorable: the placement palette covers the common ones
(Don/Ka/Big hits, Drumroll/Big Drumroll, and Balloon/Kusudama —
`model/fumenEdits.ts:noteTypeForTool`), and the Inspector's Type dropdown
(`NOTE_TYPE_CHOICES`) can convert a selected note to **any** named type, so none
is editor-unreachable (gated by `test/model/fumen-edits.test.ts`). The corpus has
no true purple/either-hand note type.

**Special note types** — `SPECIAL_NOTE_TYPES` (`types.ts`): `0x0e, 0x0f, 0x10,
0x11, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19`. The full-corpus census (2026-06-12)
found **every one of these confined to a single song — `wii5op`** (the Taiko Wii 5
opening medley) and its difficulty/player chart files (~486 notes total). They are
all **tap-type** (duration 0, `scoreInit` in the normal 740–1010 score range — not
balloons, which carry a small hit count; no drumroll suffix), so structurally they
behave like ordinary notes with a different skin/sound.

Phase 8 status:
- ✅ **Round-trip safe** — they decode/encode byte-perfectly as generic note records
  (Phase 0), and always have.
- ✅ **Visible + tellable apart** — `ScoreCanvas` stamps the hex id on the glyph
  (e.g. `e`, `13`) instead of an anonymous dot; when selected, the Inspector type
  dropdown shows the preserved `Special 0xNN` label.
- ✅ **Editable (preserve + relocate)** — they are selectable, movable, and
  deletable like any note; the placement palette does **not** author them.
- ⏳ **Naming** — each id's exact gameplay identity (hakushu / bongo / re-skinned
  Don-Ka / adlib …) is not yet confirmed, so naming these needs the medley's TJA
  source or an in-game cross-check.
  `fumenNoteTypeLabel()` renders them as `Special 0xNN` until then.

Any note-type id seen in the corpus that is neither named nor in
`SPECIAL_NOTE_TYPES` is a regression — the coverage test
(`test/codec/fumen-note-types.test.ts`) fails so a human classifies it.

## Scoring model — `scoreInit` / `scoreDiff` and `dummyData`

The corpus carries **two** score systems. Modern play uses **真打 (Shinuchi)** —
a fixed points-per-note with no combo growth — and none of it lives in the fumen:
the points-per-Good and the target they are tuned against sit in musicinfo as
`shinuti*` / `shinutiScore*` (derived in `model/shinuchi.ts`). But every note *also*
carries the older **旧配点** arithmetic-progression parameters, and `dummyData`
(header byte 508) is that system's precomputed theoretical maximum. It is
**derived data**, not an opaque blob.

Legacy per-note score at combo index `c` (1-based, counting only combo notes):

```
noteScore(c) = scoreInit + scoreDiff × min(floor(c / 10), 10)
```

i.e. the base (`scoreInit`, 初項) rises by one `scoreDiff` (公差) step every 10
combo, **capping at combo 100** (multiplier 10). Combo is incremented by tap notes
only — **balloons and drumrolls do not tick combo and contribute nothing** to this
maximum (drumroll/balloon points are variable, so they are excluded from the
ceiling). `scoreInit` and `scoreDiff` are constant across a chart.

`dummyData` is the sum of `noteScore(c)` over the **master branch** (the highest
non-empty branch — Master if present, else the single flat track):

```
dummyData = Σ over master-branch tap notes of (scoreInit + scoreDiff × min(floor(combo/10), 10))
```

Verified against the corpus: this reproduces the stored `dummyData` **byte-exact on
15,013 / 15,075 charts (99.6%)** using the master branch. The ~0.4% that differ are
almost all two-player co-op `_2` chart files, whose stored `dummyData` is inherited
from a sibling chart rather than recomputed from their own notes (a known
authoring-time quirk, not a formula gap).

**Authoring.** For a new chart, pick a uniform `scoreInit`/`scoreDiff` (the corpus
tunes them per chart so the ceiling lands near a target; both are multiples of 10 —
all 932,647 tap `scoreInit` values and all but 450 `scoreDiff` values, though
`scoreDiff` is not *required* to be), write the same pair on every combo note **and
on the drumrolls** (2,786 of the 2,798 corpus charts with rolls stamp them exactly
like taps, even though they are excluded from the ceiling; only balloons differ,
keeping their hit count in `scoreInit` and 0 in `scoreDiff`), then set `dummyData` to
the sum above over the master branch. Because the
live engine scores in Shinuchi, exact `scoreInit`/`scoreDiff` values do not affect
gameplay — but keeping `dummyData` consistent with them matches every official file.
`codec/fumen/authoring.ts:computeScoreCeiling(fumen)` implements this exactly (pinned
to the corpus by `test/codec/fumen-scoring.test.ts`); `timingWindowsForDifficulty` and
`soulGaugeDefaults` fill the other difficulty-keyed header fields.

## Soul gauge — `hpClear` / `hpGainGood` / `hpGainOk` / `hpLossBad`

The soul gauge (魂ゲージ) runs on an internal 0..`hpMax` scale (`hpMax` = **10000** in
every corpus file). Clearing needs the gauge to reach `hpClear` — a clean
per-difficulty **norma**: Easy **6000**, Normal/Hard **7000**, Oni/Ura **8000**. Each
良 adds `hpGainGood`, each 可 adds `hpGainOk`, each 不可 adds `hpLossBad` (negative).

All three deltas have the same shape — a **constant divided by the chart's tap count,
rounded up**:

```
hpGainGood =  ceil(Cgood / tapCount)
hpGainOk   =  ceil(Cok   / tapCount)
hpLossBad  = −ceil(Cbad  / tapCount)
```

The constants are keyed by **difficulty and star rating**, and the ceil is applied to
each field *separately*. That last detail is what makes the fields look inconsistent
in shipped files: `hpGainOk` is sometimes `⌈0.75 × good⌉` and sometimes `⌊0.75 × good⌋`
(easy ★1 `mclinn` stores 145 for good 194, while `otoppe` stores 338 for good 450) —
because neither is derived from `good` at all. Only the *constants* sit in a fixed
ratio: `Cok / Cgood` is 0.75 for Easy–Hard and ≈0.49 for Oni/Ura, and `Cbad / Cgood`
climbs by rank through 0.5, 0.75, 1.0, 1.16, 1.25, 1.6 and 2.0. `Cgood` itself runs
≈12,600–16,650, so an all-good clear fills the gauge on roughly 60–80 % of the notes
and then overfills to ~125–165 %.

The earlier reading of this field — `hpGainGood = ceil(10000 / a)` for an integer 良
count `a` — is **wrong**: 401 of the 4,341 rated charts hold a `hpGainGood` no integer
`a` can produce (194 is unreachable, since `a` = 51 gives 197 and `a` = 52 gives 193).

`hpMax` and `hpClear` are exact. The delta constants are corpus fits, not a recovered
authoring formula: the shipped values carry a per-chart balancing choice on top of the
rating, so a single constant per (difficulty, star) cannot hit every chart.
`codec/fumen/authoring.ts:soulGaugeDefaults(difficulty, tapCount, star)` implements
the model with a table fitted on CHN, and reproduces the shipped values on **89 % of
charts per field, 77 % on all three at once, and 98.5 % within 5 %** — the same rates
on the JPN dump the table was not fitted to. `test/codec/soul-gauge-corpus.test.ts`
pins those floors on both dumps.

## Reserved fields — confirmed always zero

Full-corpus probe, 2026-06-12 (15,075 files, 5,720,243 notes, 83,730 drumroll
suffixes). Every one of these fields was **zero in every record**, so they are
genuine reserved padding, not hidden data:

| Field                         | Where        | Observation |
|-------------------------------|--------------|-------------|
| `FumenNote.padding` (f32)     | each note    | 0 / 5,720,243 |
| `FumenNote.drumrollSuffix`    | drumroll notes | the only distinct value seen is `00 00 00 00 00 00 00 00` (×83,730) |
| `FumenMeasure.padding1` (u16) | each measure | 0 in every measure |
| `FumenMeasure.padding2` (i32) | each measure | 0 in every measure |
| `FumenBranch.padding` (u16)   | each branch  | 0 in every branch |

Consequence for editing: a newly authored note/measure/branch must write zeros
for these. `decode.ts`/`encode.ts` carry the original bytes for decoded data;
the note constructors (`model/fumenEdits.ts:makeNote`) and the encoder synthesize
zeros for hand-built records, so an edit can never drift from this convention.

## 100% data coverage (the acceptance gate)

`test/codec/fumen-coverage.test.ts` (Phase 8.6) re-walks every corpus payload with
an **independent** second parser and attributes every byte to a named category —
either a typed field (`header`, measure/branch/note typed fields) or a
documented-constant reserved region (the paddings + drumroll suffix above). It then
asserts the categories tile the whole payload with **no gap and no leftover** (so
there is no opaque trailing blob) and that every byte of a reserved region is zero
on disk. Result over the full corpus (15,075 files, 234,427,824 bytes):
**194,258,296 typed + 40,169,528 reserved + 0 opaque.** The `trailer` field is empty
on every corpus file (probed) — there are no bytes after the last measure. This is
stronger than the Phase 0 round-trip, which only proves bytes are *preserved*: this
proves every byte is *accounted for*, so no editable-space byte is an undocumented
blob.
