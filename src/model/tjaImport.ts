// TJA parsing and conversion for the preview-first Import TJA workflow.
//
// The binary conversion model follows tja2fumen's documented semantics (MIT,
// Copyright (c) 2023 Vivaria), then hardens the edge cases present in the local
// ESE corpus: omitted OFFSET fields, Tower/Dan courses, decimal score values,
// incomplete balloon lists, and branch-local mid-measure commands. See
// app/THIRD_PARTY_NOTICES.md for the full license notice.

import type {
  Fumen,
  FumenBranch,
  FumenMeasure,
  FumenNote,
  MusicInfoChartDerivedPatch,
  MusicInfoEditableField,
} from '../codec';
import { encodeFumen } from '../codec';
import type { RawDatatables } from '../fs/datatables';
import {
  DIFFICULTY_ORDER,
  PLAYER_ORDER,
  fumenFilename,
  type FumenDifficulty,
  type FumenPlayer,
  type FumenSlot,
} from '../fs/fumens';
import { editMusicInfo, setStar, setSubtitle, setTitle, syncChartMetadata, type StarField } from './edits';
import { calculateBranchNoteLabels } from './fumenNoteLabels';
import { CHART_METADATA_FIELDS, summarizeFumenMetadata } from './fumenMetadata';
import { cloneFumen } from './fumenSlots';
import {
  DEFAULT_CHART_SCORING,
  makeBlankFumen,
  refreshChartDerivedHeader,
  type ChartScoring,
} from './fumenScaffold';
import { SHINUCHI_ABSENT, shinuchiScoring } from './shinuchi';
import type { Locale } from './songlist';

const BRANCHES = ['normal', 'professional', 'master'] as const;
type TjaBranch = (typeof BRANCHES)[number];
type BranchMap<T> = Record<TjaBranch, T>;

export type TjaSourceCourse = 'easy' | 'normal' | 'hard' | 'oni' | 'ura' | 'tower' | 'dan';

export type TjaImportWarningCode =
  | 'missing-offset'
  | 'special-course'
  | 'ignored-command'
  | 'invalid-note'
  | 'branch-padded'
  | 'balloon-defaulted'
  | 'orphan-roll-end'
  | 'overlapping-long-note'
  | 'duplicate-course'
  | 'invalid-value';

export interface TjaImportWarning {
  code: TjaImportWarningCode;
  detail?: string;
  count: number;
}

class WarningCollector {
  private readonly values = new Map<string, TjaImportWarning>();

  add(code: TjaImportWarningCode, detail?: string): void {
    const key = `${code}\u0000${detail ?? ''}`;
    const current = this.values.get(key);
    if (current) current.count++;
    else this.values.set(key, { code, detail, count: 1 });
  }

  list(): TjaImportWarning[] {
    return [...this.values.values()];
  }
}

interface TjaTextFields {
  base: string;
  ja?: string;
  zh?: string;
  ko?: string;
}

interface TjaData {
  name: 'note' | TjaEventName;
  value: string;
  pos: number;
  order: number;
}

type TjaEventName =
  | 'gogo'
  | 'barline'
  | 'delay'
  | 'scroll'
  | 'bpm'
  | 'measure'
  | 'levelhold'
  | 'senote'
  | 'section'
  | 'branch_start';

interface TjaMeasure {
  notes: string;
  events: TjaData[];
  combined: TjaData[];
}

interface TjaCourse {
  sourceCourse: TjaSourceCourse;
  difficulty: FumenDifficulty;
  player: FumenPlayer;
  bpm: number;
  offset: number;
  level: number;
  scoreInit: number;
  shinutiBase: number;
  scoreDiff: number;
  balloon: number[];
  balloonByBranch: Partial<BranchMap<number[]>>;
  data: string[];
  branches: BranchMap<TjaMeasure[]>;
  hasBranches: boolean;
}

export interface ParsedTjaSong {
  bpm: number;
  offset: number;
  title: TjaTextFields;
  subtitle: TjaTextFields;
  /** DEMOSTART in milliseconds; undefined when the TJA omits it or it is unusable. */
  demoStartMs?: number;
  courses: TjaCourse[];
  warnings: TjaImportWarning[];
}

export interface TjaImportChart {
  slot: Omit<FumenSlot, 'filename'>;
  sourceCourse: TjaSourceCourse;
  level: number;
  /** TJA SCOREINIT value written into ordinary fumen notes. */
  scoreBase: number;
  /** Stored fumen score step (TJA SCOREDIFF × 4). */
  scoreStep: number;
  /** Shin-uchi base score for musicinfo, or 0 when the TJA carries none. */
  shinutiBase: number;
  fumen: Fumen;
}

export interface TjaImportResult {
  title: Record<Locale, string>;
  subtitle: Record<Locale, string>;
  /** Song-select demo start in milliseconds, or undefined when the TJA has none.
   *  The game keeps this value in the sound bank's TONE record rather than in the
   *  fumen or musicinfo, so applying it patches sound/<song>.nus3bank. */
  demoStartMs?: number;
  charts: TjaImportChart[];
  warnings: TjaImportWarning[];
}

/**
 * Which parts of a TJA the user chose to apply. Each maps to an independent
 * destination — musicinfo/wordlist, the fumen files, and the sound bank — so any
 * combination is a valid import.
 */
export interface TjaImportOptions {
  metadata: boolean;
  charts: boolean;
  demoStart: boolean;
}

export const DEFAULT_TJA_IMPORT_OPTIONS: TjaImportOptions = {
  metadata: true,
  charts: true,
  demoStart: true,
};

export class TjaImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TjaImportError';
  }
}

const NOTE_TYPES: Record<string, string> = {
  '0': 'Blank',
  '1': 'Don',
  '2': 'Ka',
  '3': 'DON',
  '4': 'KA',
  '5': 'Drumroll',
  '6': 'DRUMROLL',
  '7': 'Balloon',
  '8': 'EndDRB',
  '9': 'Kusudama',
  A: 'DON2',
  B: 'KA2',
  C: 'Blank',
  D: 'Drumroll',
  E: 'DON2',
  F: 'Ka',
  G: 'KA2',
  H: 'DRUMROLL',
  I: 'Drumroll',
};

const FUMEN_NOTE_TYPES: Record<string, number> = {
  Don: 0x1,
  Don2: 0x2,
  Don3: 0x3,
  Ka: 0x4,
  Ka2: 0x5,
  Drumroll: 0x6,
  DON: 0x7,
  KA: 0x8,
  DRUMROLL: 0x9,
  Balloon: 0xa,
  DON2: 0xb,
  Kusudama: 0xc,
  KA2: 0xd,
};

const SENOTE_TYPES: Record<number, string> = {
  1: 'Don',
  2: 'Don2',
  3: 'Don3',
  4: 'Ka',
  5: 'Ka2',
};

const COURSE_VALUES: Record<string, { sourceCourse: TjaSourceCourse; difficulty: FumenDifficulty }> = {
  '0': { sourceCourse: 'easy', difficulty: 'easy' },
  easy: { sourceCourse: 'easy', difficulty: 'easy' },
  '1': { sourceCourse: 'normal', difficulty: 'normal' },
  normal: { sourceCourse: 'normal', difficulty: 'normal' },
  '2': { sourceCourse: 'hard', difficulty: 'hard' },
  hard: { sourceCourse: 'hard', difficulty: 'hard' },
  '3': { sourceCourse: 'oni', difficulty: 'oni' },
  oni: { sourceCourse: 'oni', difficulty: 'oni' },
  '4': { sourceCourse: 'ura', difficulty: 'ura' },
  edit: { sourceCourse: 'ura', difficulty: 'ura' },
  ura: { sourceCourse: 'ura', difficulty: 'ura' },
  '5': { sourceCourse: 'tower', difficulty: 'oni' },
  tower: { sourceCourse: 'tower', difficulty: 'oni' },
  '6': { sourceCourse: 'dan', difficulty: 'oni' },
  dan: { sourceCourse: 'dan', difficulty: 'oni' },
};

const STAR_FIELDS: Record<FumenDifficulty, StarField> = {
  easy: 'starEasy',
  normal: 'starNormal',
  hard: 'starHard',
  oni: 'starMania',
  ura: 'starUra',
};

/**
 * Where a course's Shin-uchi scoring lands in musicinfo: the base score per Good
 * (`SHINUTI_FIELDS`) and the all-Good target it is tuned against
 * (`SHINUTI_SCORE_FIELDS`). The Duet twin is written alongside each: the corpus
 * keeps the two in lockstep (1037 of 1042 CHN songs, and every song for Oni/Ura),
 * and a TJA has no separate Duet scoring.
 */
export type ShinutiField = Extract<MusicInfoEditableField, `shinuti${string}`>;

export const SHINUTI_FIELDS: Record<FumenDifficulty, readonly ShinutiField[]> = {
  easy: ['shinutiEasy', 'shinutiEasyDuet'],
  normal: ['shinutiNormal', 'shinutiNormalDuet'],
  hard: ['shinutiHard', 'shinutiHardDuet'],
  oni: ['shinutiMania', 'shinutiManiaDuet'],
  ura: ['shinutiUra', 'shinutiUraDuet'],
};

export const SHINUTI_SCORE_FIELDS: Record<FumenDifficulty, readonly ShinutiField[]> = {
  easy: ['shinutiScoreEasy', 'shinutiScoreEasyDuet'],
  normal: ['shinutiScoreNormal', 'shinutiScoreNormalDuet'],
  hard: ['shinutiScoreHard', 'shinutiScoreHardDuet'],
  oni: ['shinutiScoreMania', 'shinutiScoreManiaDuet'],
  ura: ['shinutiScoreUra', 'shinutiScoreUraDuet'],
};

const LOCALES: Locale[] = [
  'japaneseText',
  'englishUsText',
  'chineseTText',
  'chineseSText',
  'koreanText',
];

function stripComment(line: string): string {
  const index = line.indexOf('//');
  return (index < 0 ? line : line.slice(0, index)).replace(/^\uFEFF/, '').trim();
}

function parseFinite(value: string, fallback: number, warnings: WarningCollector, field: string): number {
  const parsed = Number.parseFloat(value.trim());
  if (Number.isFinite(parsed)) return parsed;
  warnings.add('invalid-value', field);
  return fallback;
}

function parseInteger(value: string, fallback: number, warnings: WarningCollector, field: string): number {
  const parsed = parseFinite(value, fallback, warnings, field);
  return Math.round(parsed);
}

function parseNumberList(value: string, warnings: WarningCollector, field: string): number[] {
  const out: number[] = [];
  for (const part of value.split(',')) {
    if (!part.trim()) continue;
    const parsed = Number.parseFloat(part.trim());
    if (Number.isFinite(parsed)) out.push(Math.round(parsed));
    else warnings.add('invalid-value', field);
  }
  return out;
}

function emptyMeasure(): TjaMeasure {
  return { notes: '', events: [], combined: [] };
}

function emptyBranches(): BranchMap<TjaMeasure[]> {
  return { normal: [emptyMeasure()], professional: [emptyMeasure()], master: [emptyMeasure()] };
}

function cloneMeasure(measure: TjaMeasure): TjaMeasure {
  return {
    notes: measure.notes,
    events: measure.events.map((event) => ({ ...event })),
    combined: measure.combined.map((item) => ({ ...item })),
  };
}

function ensureMeasure(branch: TjaMeasure[], index: number): void {
  while (branch.length <= index) branch.push(emptyMeasure());
}

function padBranches(branches: BranchMap<TjaMeasure[]>, warnings: WarningCollector): void {
  const longestName = BRANCHES.reduce((best, name) =>
    branches[name].length > branches[best].length ? name : best, 'normal' as TjaBranch);
  const longest = branches[longestName];
  for (const name of BRANCHES) {
    if (branches[name].length === longest.length) continue;
    warnings.add('branch-padded', name);
    for (let index = branches[name].length; index < longest.length; index++) {
      branches[name].push(cloneMeasure(longest[index] ?? emptyMeasure()));
    }
  }
}

function addMeasureEvent(
  branches: BranchMap<TjaMeasure[]>,
  currentBranch: TjaBranch | 'all',
  measureIndex: number,
  event: Omit<TjaData, 'pos' | 'order'>,
  order: number,
): void {
  const targets = currentBranch === 'all' ? BRANCHES : [currentBranch];
  for (const name of targets) {
    ensureMeasure(branches[name], measureIndex);
    const measure = branches[name][measureIndex];
    measure.events.push({ ...event, pos: measure.notes.length, order });
  }
}

function parseCourseData(
  data: string[],
  warnings: WarningCollector,
): { branches: BranchMap<TjaMeasure[]>; hasBranches: boolean; balloonMarkers: BranchMap<string[]> } {
  const branches = emptyBranches();
  const hasBranches = data.some((line) => /^#BRANCH/i.test(line));
  let currentBranch: TjaBranch | 'all' = hasBranches ? 'all' : 'normal';
  let measureIndex = 0;
  let branchStartIndex = 0;
  let branchCondition = '';
  let order = 0;
  const balloonMarkers: BranchMap<string[]> = { normal: [], professional: [], master: [] };

  const targetBranches = (): readonly TjaBranch[] => currentBranch === 'all' ? BRANCHES : [currentBranch];

  for (let lineIndex = 0; lineIndex < data.length; lineIndex++) {
    const line = data[lineIndex];
    const match = /^#([A-Za-z0-9]+)(?:\s+(.+))?/.exec(line);
    if (!match) {
      const compact = line.replace(/\s+/g, '');
      for (const char of compact) {
        if (char === ',') {
          for (const name of targetBranches()) {
            ensureMeasure(branches[name], measureIndex);
            branches[name].push(emptyMeasure());
          }
          measureIndex++;
          continue;
        }
        for (const name of targetBranches()) {
          ensureMeasure(branches[name], measureIndex);
          branches[name][measureIndex].notes += char;
        }
        if (char === '7' || char === '9') {
          for (const name of targetBranches()) balloonMarkers[name].push(currentBranch === 'all' ? 'DUPE' : char);
        }
      }
      continue;
    }

    let command = match[1].toUpperCase();
    if (command === 'SCROL') command = 'SCROLL'; // two ESE charts contain this recoverable typo
    const value = (match[2] ?? '').trim();
    const add = (name: TjaEventName, eventValue = value) =>
      addMeasureEvent(branches, currentBranch, measureIndex, { name, value: eventValue }, order++);

    switch (command) {
      case 'GOGOSTART': add('gogo', '1'); break;
      case 'GOGOEND': add('gogo', '0'); break;
      case 'BARLINEON': add('barline', '1'); break;
      case 'BARLINEOFF': add('barline', '0'); break;
      case 'DELAY': add('delay'); break;
      case 'SCROLL': add('scroll'); break;
      case 'BPMCHANGE': add('bpm'); break;
      case 'MEASURE': add('measure'); break;
      case 'LEVELHOLD': add('levelhold'); break;
      case 'SENOTECHANGE': add('senote'); break;
      case 'SECTION': {
        const next = data[lineIndex + 1] ?? '';
        if (branchCondition && !/^#BRANCHSTART/i.test(next)) add('branch_start', branchCondition);
        else add('section');
        break;
      }
      case 'BRANCHSTART':
        currentBranch = 'all';
        branchCondition = value;
        padBranches(branches, warnings);
        measureIndex = Math.max(0, Math.max(...BRANCHES.map((name) => branches[name].length)) - 1);
        branchStartIndex = measureIndex;
        add('branch_start');
        break;
      case 'N': currentBranch = 'normal'; measureIndex = branchStartIndex; break;
      case 'E': currentBranch = 'professional'; measureIndex = branchStartIndex; break;
      case 'M': currentBranch = 'master'; measureIndex = branchStartIndex; break;
      case 'BRANCHEND':
        currentBranch = 'all';
        padBranches(branches, warnings);
        measureIndex = Math.max(0, Math.max(...BRANCHES.map((name) => branches[name].length)) - 1);
        break;
      case 'START':
      case 'END':
        currentBranch = hasBranches ? 'all' : 'normal';
        break;
      case 'NEXTSONG':
      case 'LYRIC':
      case 'BMSCROLL':
      case 'HBSCROLL':
        // These do not carry a value that the official song-fumen structure can store.
        break;
      default:
        if (command) warnings.add('ignored-command', command);
        break;
    }
  }

  // A trailing comma preallocates one empty measure. Keep event-only measures,
  // but remove a wholly empty tail before equalizing all three tracks.
  for (const name of BRANCHES) {
    const branch = branches[name];
    while (branch.length > 1) {
      const tail = branch[branch.length - 1];
      if (tail.notes || tail.events.length) break;
      branch.pop();
    }
  }
  if (hasBranches) {
    padBranches(branches, warnings);
  } else {
    // Flat fumens store notes only on the Normal route; Expert/Master remain
    // empty. Keeping three copies would encode and play, but would not match
    // the official binary convention or upstream tja2fumen output.
    branches.professional = [];
    branches.master = [];
  }

  // Validate note symbols and merge notes/events in source order. Commands win
  // ties so a command at subdivision N applies to the note at subdivision N.
  for (const name of BRANCHES) {
    for (const measure of branches[name]) {
      const valid: TjaData[] = [];
      let validPos = 0;
      for (const symbol of measure.notes) {
        const noteType = NOTE_TYPES[symbol];
        if (!noteType) {
          warnings.add('invalid-note', symbol);
          continue;
        }
        if (noteType !== 'Blank') valid.push({ name: 'note', value: noteType, pos: validPos, order: order++ });
        validPos++;
      }
      measure.notes = [...measure.notes].filter((symbol) => symbol in NOTE_TYPES).join('');
      measure.combined = [...measure.events, ...valid].sort((a, b) =>
        a.pos - b.pos
        || Number(a.name === 'note') - Number(b.name === 'note')
        || a.order - b.order);
    }
  }

  return { branches, hasBranches, balloonMarkers };
}

function normalizeCourse(value: string): { sourceCourse: TjaSourceCourse; difficulty: FumenDifficulty } {
  const normalized = COURSE_VALUES[value.trim().toLowerCase()];
  if (!normalized) throw new TjaImportError(`Unsupported COURSE value: ${value || '(empty)'}.`);
  return normalized;
}

function subtitleValue(value: string): string {
  return value.startsWith('--') || value.startsWith('++') ? value.slice(2) : value;
}

interface CourseSeed {
  sourceCourse: TjaSourceCourse;
  difficulty: FumenDifficulty;
  level: number;
  scoreInit: number;
  shinutiBase: number;
  scoreDiff: number;
  balloon: number[];
  balloonByBranch: Partial<BranchMap<number[]>>;
}

function copySeed(seed: CourseSeed): CourseSeed {
  return {
    ...seed,
    balloon: [...seed.balloon],
    balloonByBranch: Object.fromEntries(
      Object.entries(seed.balloonByBranch).map(([key, value]) => [key, value ? [...value] : value]),
    ) as Partial<BranchMap<number[]>>,
  };
}

/** Parse UTF-8/Shift-JIS TJA bytes using browser-standard decoders. */
export function decodeTjaBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('shift-jis', { fatal: true }).decode(bytes);
    } catch {
      throw new TjaImportError('The file is neither valid UTF-8 nor Shift-JIS text.');
    }
  }
}

export function parseTja(text: string): ParsedTjaSong {
  const warnings = new WarningCollector();
  const lines = text.split(/\r?\n/).map(stripComment).filter(Boolean);
  if (lines.length === 0) throw new TjaImportError('The TJA file is empty.');

  let bpm: number | undefined;
  let offset: number | undefined;
  let demoStart: string | undefined;
  const title: TjaTextFields = { base: '' };
  const subtitle: TjaTextFields = { base: '' };
  for (const line of lines) {
    const match = /^([A-Za-z0-9]+):(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1].toUpperCase();
    const value = match[2].trim();
    if (name === 'BPM' && bpm === undefined) bpm = parseFinite(value, 120, warnings, 'BPM');
    else if (name === 'OFFSET' && offset === undefined) offset = parseFinite(value, 0, warnings, 'OFFSET');
    else if (name === 'DEMOSTART' && demoStart === undefined) demoStart = value;
    else if (name === 'TITLE') title.base = value;
    else if (name === 'TITLEJA') title.ja = value;
    else if (name === 'TITLEZH') title.zh = value;
    else if (name === 'TITLEKO') title.ko = value;
    else if (name === 'SUBTITLE') subtitle.base = subtitleValue(value);
    else if (name === 'SUBTITLEJA') subtitle.ja = subtitleValue(value);
    else if (name === 'SUBTITLEZH') subtitle.zh = subtitleValue(value);
    else if (name === 'SUBTITLEKO') subtitle.ko = subtitleValue(value);
  }
  if (!Number.isFinite(bpm) || (bpm as number) <= 0) throw new TjaImportError('TJA does not contain a positive BPM value.');
  if (offset === undefined) {
    offset = 0;
    warnings.add('missing-offset');
  }
  // DEMOSTART is seconds from the audio's own zero. Unlike every other header it
  // has no home in the fumen or musicinfo — the game reads it from the sound
  // bank — so it is carried out as milliseconds for the caller to patch there.
  // Slightly negative values are common in the wild (ESE has -0.038 and -0.045,
  // authoring artefacts of an offset subtraction) and mean "from the start", so
  // they clamp to 0 exactly as the bank field and its editor do. Only a value
  // that is no number at all is dropped: the position the bank already carries
  // beats one invented here.
  let demoStartMs: number | undefined;
  if (demoStart !== undefined && demoStart !== '') {
    const seconds = Number(demoStart);
    if (Number.isFinite(seconds)) demoStartMs = Math.max(0, Math.round(seconds * 1000));
    else warnings.add('invalid-value', 'DEMOSTART');
  }

  let seed: CourseSeed | undefined;
  let active: (CourseSeed & { player: FumenPlayer; data: string[] }) | undefined;
  const rawCourses: (CourseSeed & { player: FumenPlayer; data: string[] })[] = [];

  const finishActive = () => {
    if (active && active.data.some((line) => !/^#(?:START|END)/i.test(line))) rawCourses.push(active);
    active = undefined;
  };

  for (const line of lines) {
    const metadata = /^([A-Za-z0-9]+):(.*)$/.exec(line);
    if (metadata) {
      const name = metadata[1].toUpperCase();
      const value = metadata[2].trim();
      if (name === 'COURSE') {
        finishActive();
        const normalized = normalizeCourse(value);
        seed = {
          ...normalized,
          level: 1,
          scoreInit: 0,
          shinutiBase: 0,
          scoreDiff: 0,
          balloon: [],
          balloonByBranch: {},
        };
        if (normalized.sourceCourse === 'tower' || normalized.sourceCourse === 'dan') {
          warnings.add('special-course', normalized.sourceCourse);
        }
      } else if (seed) {
        if (name === 'LEVEL') seed.level = Math.max(1, Math.min(10, parseInteger(value, 1, warnings, 'LEVEL')));
        else if (name === 'SCOREINIT') {
          // `SCOREINIT:a,b` carries two different scores: `a` is the legacy base
          // written into every fumen note, `b` is the Shin-uchi base that lives in
          // musicinfo (`shinuti*`) instead. Cross-checking every ESE chart that
          // also ships officially, the official fumen's base equals the first
          // value 1181 times against 5 for the last, and the last value equals
          // musicinfo's `shinuti*` for 1789 of 1908 charts — the remainder are
          // charts revised between the ESE rip and our dump.
          const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
          seed.scoreInit = parts[0] === undefined ? 0 : parseFinite(parts[0], 0, warnings, 'SCOREINIT');
          seed.shinutiBase = parts.length < 2
            ? 0
            : parseFinite(parts[parts.length - 1], 0, warnings, 'SCOREINIT');
        } else if (name === 'SCOREDIFF') {
          const last = value.split(',').map((part) => part.trim()).filter(Boolean).at(-1);
          seed.scoreDiff = last === undefined ? 0 : parseFinite(last, 0, warnings, 'SCOREDIFF');
        } else if (name === 'BALLOON') seed.balloon = parseNumberList(value, warnings, 'BALLOON');
        else if (name === 'BALLOONNOR') seed.balloonByBranch.normal = parseNumberList(value, warnings, 'BALLOONNOR');
        else if (name === 'BALLOONEXP') seed.balloonByBranch.professional = parseNumberList(value, warnings, 'BALLOONEXP');
        else if (name === 'BALLOONMAS') seed.balloonByBranch.master = parseNumberList(value, warnings, 'BALLOONMAS');
      }
      continue;
    }

    const start = /^#START(?:\s+(.+))?/i.exec(line);
    if (start) {
      if (!seed) throw new TjaImportError('#START appears before the first COURSE field.');
      finishActive();
      let value = (start[1] ?? '').trim().toUpperCase();
      if (value === '1P' || value === '2P') value = `${value[1]}${value[0]}`;
      const player: FumenPlayer = value === 'P1' ? 'p1' : value === 'P2' ? 'p2' : 'single';
      if (value && value !== 'P1' && value !== 'P2') warnings.add('invalid-value', `#START ${value}`);
      active = { ...copySeed(seed), player, data: ['#START'] };
      continue;
    }
    if (active) {
      active.data.push(line);
      if (/^#END/i.test(line)) finishActive();
    }
  }
  finishActive();
  if (rawCourses.length === 0) throw new TjaImportError('The TJA file does not contain a chart between #START and #END.');

  const bySlot = new Map<string, TjaCourse>();
  for (const raw of rawCourses) {
    const parsed = parseCourseData(raw.data, warnings);
    const course: TjaCourse = {
      ...raw,
      bpm: bpm as number,
      offset,
      branches: parsed.branches,
      hasBranches: parsed.hasBranches,
      balloon: fixBalloonValues(raw.balloon, raw.balloonByBranch, parsed.balloonMarkers),
    };
    const key = `${course.difficulty}:${course.player}`;
    const existing = bySlot.get(key);
    // A normal song course is more representative than a Tower/Dan course if a
    // non-standard file happens to contain both. Otherwise the later chart wins,
    // matching common TJA-player behavior for duplicate COURSE sections.
    if (existing) warnings.add('duplicate-course', key);
    const existingSpecial = existing?.sourceCourse === 'tower' || existing?.sourceCourse === 'dan';
    const nextSpecial = course.sourceCourse === 'tower' || course.sourceCourse === 'dan';
    if (!existing || existingSpecial || !nextSpecial) bySlot.set(key, course);
  }

  return {
    bpm: bpm as number,
    offset,
    title,
    subtitle,
    demoStartMs,
    courses: [...bySlot.values()],
    warnings: warnings.list(),
  };
}

function fixBalloonValues(
  field: number[],
  byBranch: Partial<BranchMap<number[]>>,
  markers: BranchMap<string[]>,
): number[] {
  if (Object.values(byBranch).some((values) => values && values.length > 0)) {
    return BRANCHES.flatMap((name) => byBranch[name] ?? []);
  }
  const branched = BRANCHES.every((name) => markers[name].length > 0);
  if (!branched) return [...field];
  if (BRANCHES.every((name) => markers[name].length === field.length)) return [...field, ...field, ...field];
  if (!BRANCHES.some((name) => markers[name].includes('DUPE'))) return [...field];
  const total = BRANCHES.reduce((sum, name) => sum + markers[name].length, 0);
  if (field.length >= total) return [...field];

  const source = [...field];
  const duplicated: number[] = [];
  const fixed: number[] = [];
  for (const marker of markers.normal) {
    const value = source.shift();
    if (value === undefined) return fixed;
    fixed.push(value);
    if (marker === 'DUPE') duplicated.push(value);
  }
  for (const name of ['professional', 'master'] as const) {
    const dupes = [...duplicated];
    for (const marker of markers[name]) {
      const value = marker === 'DUPE' ? dupes.shift() : source.shift();
      if (value === undefined) return fixed;
      fixed.push(value);
    }
  }
  return fixed;
}

interface PreparedNote {
  value: string;
  fraction: number;
  manualType?: string;
}

interface ProcessedMeasure {
  bpm: number;
  scroll: number;
  gogo: boolean;
  barline: boolean;
  timeSig: [number, number];
  fractionStart: number;
  fractionEnd: number;
  delay: number;
  levelhold: boolean;
  branchType: string;
  branchCond: [number, number];
  notes: PreparedNote[];
}

interface CommandState {
  bpm: number;
  scroll: number;
  gogo: boolean;
  barline: boolean;
  timeSig: [number, number];
}

const SPLIT_EVENTS = new Set<TjaEventName>(['bpm', 'scroll', 'gogo', 'barline', 'measure', 'delay', 'branch_start']);
const FRACTION_EPSILON = 1e-9;

function eventFraction(event: TjaData, subdivisions: number): number {
  return subdivisions <= 0 ? 0 : Math.max(0, Math.min(1, event.pos / subdivisions));
}

function measureBoundaries(measures: BranchMap<TjaMeasure[]>, index: number): number[] {
  const values = new Set<number>([0, 1]);
  for (const name of BRANCHES) {
    const measure = measures[name][index] ?? emptyMeasure();
    const subdivisions = measure.notes.length;
    for (const event of measure.events) {
      if (event.name === 'note') continue;
      if (!SPLIT_EVENTS.has(event.name)) continue;
      const fraction = eventFraction(event, subdivisions);
      if (fraction > FRACTION_EPSILON && fraction < 1 - FRACTION_EPSILON) values.add(fraction);
    }
  }
  return [...values].sort((a, b) => a - b);
}

function applyStateEvent(
  state: CommandState,
  event: TjaData,
  warnings: WarningCollector,
): { delay?: number; levelhold?: boolean; branchType?: string; branchCond?: [number, number] } {
  switch (event.name) {
    case 'bpm': {
      const value = parseFinite(event.value, state.bpm, warnings, '#BPMCHANGE');
      if (value > 0) state.bpm = value;
      break;
    }
    case 'scroll': state.scroll = parseFinite(event.value, state.scroll, warnings, '#SCROLL'); break;
    case 'gogo': state.gogo = event.value === '1'; break;
    case 'barline': state.barline = event.value === '1'; break;
    case 'measure': {
      const match = /^(\d+)\s*\/\s*(\d+)$/.exec(event.value);
      if (match && Number(match[2]) > 0) state.timeSig = [Number(match[1]), Number(match[2])];
      else warnings.add('invalid-value', '#MEASURE');
      break;
    }
    case 'delay': return { delay: parseFinite(event.value, 0, warnings, '#DELAY') * 1000 };
    case 'levelhold': return { levelhold: true };
    case 'branch_start': {
      const parts = event.value.split(',').map((part) => part.trim());
      if (parts.length !== 3) {
        warnings.add('invalid-value', '#BRANCHSTART');
        break;
      }
      const type = parts[0].toLowerCase();
      let first = parseFinite(parts[1], 0, warnings, '#BRANCHSTART');
      let second = parseFinite(parts[2], 0, warnings, '#BRANCHSTART');
      if (type === 'p') { first /= 100; second /= 100; }
      if (type !== 'p' && type !== 'r') warnings.add('invalid-value', '#BRANCHSTART');
      else return { branchType: type, branchCond: [first, second] };
      break;
    }
    case 'senote':
    case 'section':
      break;
  }
  return {};
}

function preparedNotes(measure: TjaMeasure): PreparedNote[] {
  const subdivisions = measure.notes.length;
  const out: PreparedNote[] = [];
  let pendingSenote: string | undefined;
  for (const item of measure.combined) {
    if (item.name === 'senote') {
      const parsed = SENOTE_TYPES[Math.round(Number(item.value))];
      if (parsed) pendingSenote = parsed;
    } else if (item.name === 'note') {
      out.push({
        value: item.value,
        fraction: subdivisions <= 0 ? 0 : item.pos / subdivisions,
        manualType: pendingSenote,
      });
      pendingSenote = undefined;
    }
  }
  return out;
}

function processCommands(
  branches: BranchMap<TjaMeasure[]>,
  initialBpm: number,
  warnings: WarningCollector,
): BranchMap<ProcessedMeasure[]> {
  const result: BranchMap<ProcessedMeasure[]> = { normal: [], professional: [], master: [] };
  const state: BranchMap<CommandState> = {
    normal: { bpm: initialBpm, scroll: 1, gogo: false, barline: true, timeSig: [4, 4] },
    professional: { bpm: initialBpm, scroll: 1, gogo: false, barline: true, timeSig: [4, 4] },
    master: { bpm: initialBpm, scroll: 1, gogo: false, barline: true, timeSig: [4, 4] },
  };
  const count = Math.max(...BRANCHES.map((name) => branches[name].length));

  for (let index = 0; index < count; index++) {
    const boundaries = measureBoundaries(branches, index);
    for (const name of BRANCHES) {
      const measure = branches[name][index] ?? emptyMeasure();
      const subdivisions = measure.notes.length;
      const events = [...measure.events].sort((a, b) => a.pos - b.pos || a.order - b.order);
      const notes = preparedNotes(measure);
      let eventIndex = 0;

      for (let segment = 0; segment < boundaries.length - 1; segment++) {
        const start = boundaries[segment];
        const end = boundaries[segment + 1];
        let delay = 0;
        let levelhold = false;
        let branchType = '';
        let branchCond: [number, number] = [0, 0];
        while (eventIndex < events.length && eventFraction(events[eventIndex], subdivisions) <= start + FRACTION_EPSILON) {
          const applied = applyStateEvent(state[name], events[eventIndex++], warnings);
          delay += applied.delay ?? 0;
          levelhold ||= applied.levelhold ?? false;
          if (applied.branchType) {
            branchType = applied.branchType;
            branchCond = applied.branchCond ?? [0, 0];
          }
        }
        const segmentNotes = notes.filter((note) =>
          note.fraction >= start - FRACTION_EPSILON && note.fraction < end - FRACTION_EPSILON);
        result[name].push({
          bpm: state[name].bpm,
          scroll: state[name].scroll,
          gogo: state[name].gogo,
          barline: state[name].barline && start === 0,
          timeSig: [...state[name].timeSig],
          fractionStart: start,
          fractionEnd: end,
          delay,
          levelhold,
          branchType,
          branchCond,
          notes: segmentNotes,
        });
      }
      // Commands at the exact end of a measure carry into the next one.
      while (eventIndex < events.length) applyStateEvent(state[name], events[eventIndex++], warnings);
    }
  }
  return result;
}

function branchIndex(name: TjaBranch): 0 | 1 | 2 {
  return BRANCHES.indexOf(name) as 0 | 1 | 2;
}

function blankBranch(speed = 1): FumenBranch {
  return { padding: 0, speed, notes: [] };
}

function setBranchInfo(
  measure: FumenMeasure,
  name: TjaBranch,
  type: string,
  condition: [number, number],
  points: number,
  levelhold: boolean,
): void {
  let values: [number, number];
  if (levelhold) {
    values = name === 'normal' ? [999, 999] : name === 'professional' ? [0, 999] : [0, 0];
  } else if (type === 'p') {
    values = condition.map((value) => value > 1 ? 999 : value > 0 ? Math.trunc(points * value) : 0) as [number, number];
  } else if (type === 'r') {
    values = condition.map(Math.trunc) as [number, number];
  } else {
    return;
  }
  const start = branchIndex(name) * 2;
  measure.branchInfo[start] = values[0];
  measure.branchInfo[start + 1] = values[1];
}

function pointsForNote(type: number): number {
  if (type >= 0x1 && type <= 0x5) return 20;
  if (type === 0x7 || type === 0x8 || type === 0xb || type === 0xd) return 20;
  if (type === 0xa || type === 0xc) return 30;
  return 0;
}

function safeU16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(Number.isFinite(value) ? value : 0)));
}

/**
 * Snap a legacy per-note score to the nearest ten. Every one of the corpus's
 * 932,647 tap `scoreInit` values is a multiple of ten, as are all but 450 of the
 * `scoreDiff` values — and a TJA's SCOREDIFF is a *quarter* of the fumen value,
 * rounded, so scaling it back up needs the same snap to land on the original
 * (akb365 Easy: 573 × 4 = 2292, where the shipped fumen holds 2290).
 */
function legacyScore(value: number): number {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  return Math.min(Math.round(safe / 10) * 10, 0xffff - (0xffff % 10));
}

function scoreValues(course: TjaCourse): ChartScoring {
  const base = course.scoreInit > 0
    ? Math.max(10, legacyScore(course.scoreInit))
    : DEFAULT_CHART_SCORING.base;
  const diff = course.scoreDiff >= 0
    ? legacyScore(course.scoreDiff * 4)
    : DEFAULT_CHART_SCORING.diff;
  return { base, diff };
}

function applyGeneratedNoteLabels(fumen: Fumen, manuallySet: WeakSet<FumenNote>): Fumen {
  const predictions = BRANCHES.map((_, index) => calculateBranchNoteLabels(fumen, index as 0 | 1 | 2));
  return {
    ...fumen,
    measures: fumen.measures.map((measure) => ({
      ...measure,
      branches: measure.branches.map((branch, index) => ({
        ...branch,
        notes: branch.notes.map((note) => {
          const predicted = predictions[index].get(note);
          return predicted !== undefined && !manuallySet.has(note) && predicted !== note.type
            ? { ...note, type: predicted }
            : note;
        }),
      })) as [FumenBranch, FumenBranch, FumenBranch],
    })),
  };
}

function convertCourse(course: TjaCourse, warnings: WarningCollector): Fumen {
  const processed = processCommands(course.branches, course.bpm, warnings);
  const canonical = processed.normal.length > 0 ? processed.normal : processed.master;
  if (canonical.length === 0) throw new TjaImportError(`The ${course.sourceCourse} course has no measures.`);

  const measures: FumenMeasure[] = [];
  const durations: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < canonical.length; index++) {
    const source = canonical[index];
    const bpm = source.bpm > 0 && Number.isFinite(source.bpm) ? source.bpm : course.bpm;
    const measureRatio = source.timeSig[1] > 0 ? source.timeSig[0] / source.timeSig[1] : 1;
    const duration = 4 * 60_000 / bpm * measureRatio * (source.fractionEnd - source.fractionStart);
    const offset = index === 0
      ? -course.offset * 1000 - 4 * 60_000 / bpm
      : ends[index - 1] + source.delay + 4 * 60_000 / measures[index - 1].bpm - 4 * 60_000 / bpm;
    durations.push(duration);
    ends.push(offset + duration);
    measures.push({
      bpm,
      offset,
      gogo: source.gogo ? 1 : 0,
      barline: source.barline ? 1 : 0,
      padding1: 0,
      branchInfo: [-1, -1, -1, -1, -1, -1],
      padding2: 0,
      branches: [blankBranch(), blankBranch(), blankBranch()],
    });
  }

  const manuallySet = new WeakSet<FumenNote>();
  const balloonValues = [...course.balloon];
  const totalNotes: BranchMap<number> = { normal: 0, professional: 0, master: 0 };
  const branchTypes: string[] = [];
  const branchConditions: [number, number][] = [];
  const scoring = scoreValues(course);

  for (const name of BRANCHES) {
    let currentLong: { note: FumenNote; startedAt: number } | undefined;
    let branchPointsTotal = 0;
    let previousMeasurePoints = 0;
    let levelhold = false;
    const branch = processed[name];
    for (let index = 0; index < measures.length; index++) {
      const source = branch[index] ?? canonical[index];
      const measure = measures[index];
      const output = measure.branches[branchIndex(name)];
      output.speed = Number.isFinite(source.scroll) ? source.scroll : 1;

      if (source.branchType) {
        setBranchInfo(measure, name, source.branchType, source.branchCond, branchPointsTotal, levelhold);
        branchPointsTotal = 0;
        levelhold = false;
        if (name === 'normal') {
          branchTypes.push(source.branchType);
          branchConditions.push(source.branchCond);
        }
      }
      branchPointsTotal += previousMeasurePoints;
      if (source.levelhold) levelhold = true;
      previousMeasurePoints = 0;

      for (const sourceNote of source.notes) {
        const segmentRatio = Math.max(FRACTION_EPSILON, source.fractionEnd - source.fractionStart);
        const position = durations[index] * ((sourceNote.fraction - source.fractionStart) / segmentRatio);
        const sourceType = sourceNote.manualType ?? sourceNote.value;
        if (sourceType === 'EndDRB') {
          if (!currentLong) {
            warnings.add('orphan-roll-end');
            continue;
          }
          if (currentLong.startedAt === index) currentLong.note.duration = Math.max(1, position - currentLong.note.position);
          else currentLong.note.duration += Math.max(0, position);
          currentLong.note.duration = Math.max(1, Math.trunc(currentLong.note.duration));
          currentLong = undefined;
          continue;
        }
        if (sourceType === 'Kusudama' && currentLong) continue;
        const type = FUMEN_NOTE_TYPES[sourceType];
        if (!type) continue;
        const balloon = type === 0xa || type === 0xc;
        const roll = type === 0x6 || type === 0x9;
        if ((roll || balloon) && currentLong) {
          currentLong.note.duration += currentLong.startedAt === index
            ? Math.max(1, position - currentLong.note.position)
            : Math.max(0, position);
          currentLong.note.duration = Math.max(1, Math.trunc(currentLong.note.duration));
          currentLong = undefined;
          warnings.add('overlapping-long-note');
        }
        const nextBalloon = balloon ? balloonValues.shift() : undefined;
        const note: FumenNote = {
          type,
          position: Math.max(0, position),
          item: 0,
          padding: 0,
          scoreInit: balloon ? safeU16(nextBalloon ?? 1) : scoring.base,
          scoreDiff: balloon || roll ? 0 : scoring.diff,
          duration: 0,
          ...(type === 0x6 ? { drumrollSuffix: new Uint8Array(8) } : {}),
        };
        if (balloon && note.scoreInit <= 0) note.scoreInit = 1;
        if (balloon && (nextBalloon === undefined || nextBalloon <= 0)) warnings.add('balloon-defaulted');
        if (sourceNote.manualType) manuallySet.add(note);
        if (roll || balloon) currentLong = { note, startedAt: index };
        else totalNotes[name]++;
        previousMeasurePoints += pointsForNote(type);
        output.notes.push(note);
      }

      if (currentLong) {
        currentLong.note.duration += currentLong.startedAt === index
          ? Math.max(0, durations[index] - currentLong.note.position)
          : durations[index];
      }
    }
  }

  // The final fumen measure has no following offset from which the editor can
  // recover a non-4/4 duration. A few charts also end with a deliberately tiny
  // BPM, whose bias makes the stored final offset lower than the first and thus
  // defeats the editor's offset-column usability check. Add a silent terminal
  // measure only when either case needs an unambiguous final boundary.
  const lastIndex = measures.length - 1;
  const last = measures[lastIndex];
  const nominalLastDuration = 4 * 60_000 / last.bpm;
  const lastMaxPosition = Math.max(
    -1,
    ...last.branches.flatMap((branch) => branch.notes.map((note) => note.position)),
  );
  if (lastMaxPosition > nominalLastDuration + 1 || last.offset <= measures[0].offset) {
    const terminalBpm = last.offset <= measures[0].offset ? course.bpm : last.bpm;
    const terminalNominalDuration = 4 * 60_000 / terminalBpm;
    measures.push({
      bpm: terminalBpm,
      offset: last.offset + durations[lastIndex] + nominalLastDuration - terminalNominalDuration,
      gogo: 0,
      barline: 0,
      padding1: 0,
      branchInfo: [-1, -1, -1, -1, -1, -1],
      padding2: 0,
      branches: [blankBranch(), blankBranch(), blankBranch()],
    });
  }

  const blank = makeBlankFumen(course.difficulty);
  let fumen: Fumen = {
    ...blank,
    measures,
    header: {
      ...blank.header,
      hasBranches: course.hasBranches ? 1 : 0,
      measureCount: measures.length,
      normalProfessionalRatio: totalNotes.professional > 0
        ? Math.trunc(65536 * totalNotes.normal / totalNotes.professional)
        : 65536,
      normalMasterRatio: totalNotes.master > 0
        ? Math.trunc(65536 * totalNotes.normal / totalNotes.master)
        : 65536,
    },
    trailer: new Uint8Array(0),
  };

  const drumrollOnly = branchTypes.length > 0 && branchTypes.every((type, index) =>
    type === 'r'
      || (type === 'p' && branchConditions[index][0] === 0 && branchConditions[index][1] === 0)
      || (type === 'p' && branchConditions[index][0] > 1 && branchConditions[index][1] > 1));
  const percentageOnly = branchTypes.length > 0 && branchTypes.every((type) => type !== 'r');
  if (drumrollOnly) {
    fumen.header.branchPtsGood = 0;
    fumen.header.branchPtsGoodBig = 0;
    fumen.header.branchPtsOk = 0;
    fumen.header.branchPtsOkBig = 0;
    fumen.header.branchPtsBalloon = 0;
    fumen.header.branchPtsKusudama = 0;
  } else if (percentageOnly) {
    fumen.header.branchPtsDrumroll = 0;
    fumen.header.branchPtsDrumrollBig = 0;
  }

  fumen = applyGeneratedNoteLabels(fumen, manuallySet);
  // The course's LEVEL keys the soul gauge, the same way musicinfo's star* does.
  fumen = refreshChartDerivedHeader(fumen, course.difficulty, scoring, course.level);
  // A final encode here is cheap compared with parsing and guarantees the
  // browser preview never offers an object the binary writer cannot represent.
  encodeFumen(fumen);
  return fumen;
}

function localizedText(text: TjaTextFields): Record<Locale, string> {
  const fallback = text.base.trim() || text.ja?.trim() || text.zh?.trim() || text.ko?.trim() || '';
  return {
    japaneseText: text.ja?.trim() || fallback,
    englishUsText: fallback,
    chineseTText: text.zh?.trim() || fallback,
    chineseSText: text.zh?.trim() || fallback,
    koreanText: text.ko?.trim() || fallback,
  };
}

function chartSort(a: TjaImportChart, b: TjaImportChart): number {
  const difficulty = DIFFICULTY_ORDER.indexOf(a.slot.difficulty) - DIFFICULTY_ORDER.indexOf(b.slot.difficulty);
  return difficulty || PLAYER_ORDER.indexOf(a.slot.player) - PLAYER_ORDER.indexOf(b.slot.player);
}

/** Parse a TJA string and produce the exact five-difficulty/three-player slot set to import. */
export function convertTjaForImport(text: string): TjaImportResult {
  const parsed = parseTja(text);
  const warnings = new WarningCollector();
  for (const warning of parsed.warnings) {
    for (let index = 0; index < warning.count; index++) warnings.add(warning.code, warning.detail);
  }

  const explicit = new Map<string, TjaImportChart>();
  for (const course of parsed.courses) {
    const fumen = convertCourse(course, warnings);
    explicit.set(`${course.difficulty}:${course.player}`, {
      slot: { difficulty: course.difficulty, player: course.player },
      sourceCourse: course.sourceCourse,
      level: course.level,
      scoreBase: scoreValues(course).base,
      scoreStep: scoreValues(course).diff,
      // musicinfo is JSON, so this one is not bound by the fumen's u16 note fields.
      shinutiBase: Math.max(0, Math.round(course.shinutiBase)),
      fumen,
    });
  }

  const charts: TjaImportChart[] = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    const single = explicit.get(`${difficulty}:single`);
    const p1 = explicit.get(`${difficulty}:p1`);
    const p2 = explicit.get(`${difficulty}:p2`);
    const representative = single ?? p1 ?? p2;
    if (!representative) continue;
    for (const player of PLAYER_ORDER) {
      const source = explicit.get(`${difficulty}:${player}`) ?? representative;
      charts.push({ ...source, slot: { difficulty, player }, fumen: cloneFumen(source.fumen) });
    }
  }
  if (charts.length === 0) throw new TjaImportError('No supported chart courses were found.');

  return {
    title: localizedText(parsed.title),
    subtitle: localizedText(parsed.subtitle),
    demoStartMs: parsed.demoStartMs,
    charts: charts.sort(chartSort),
    warnings: warnings.list(),
  };
}

export function importChartSlot(songId: string, chart: TjaImportChart): FumenSlot {
  return {
    ...chart.slot,
    filename: fumenFilename(songId, chart.slot.difficulty, chart.slot.player),
  };
}

function assignDerived(
  patch: MusicInfoChartDerivedPatch,
  field: keyof MusicInfoChartDerivedPatch,
  value: number | boolean,
): void {
  (patch as Record<string, unknown>)[field] = value;
}

/** The single-player chart carrying each difficulty's metadata for the whole song. */
function representativeCharts(imported: TjaImportResult): Map<FumenDifficulty, TjaImportChart> {
  const representative = new Map<FumenDifficulty, TjaImportChart>();
  for (const chart of imported.charts) {
    if (chart.slot.player === 'single') representative.set(chart.slot.difficulty, chart);
  }
  return representative;
}

/**
 * The complete Shin-uchi block: a base score per Good and the all-Good target it
 * is tuned against, for all five difficulties.
 *
 * A course's base is its `SCOREINIT` second value where the TJA carries one, and
 * is otherwise derived from the chart; the target always follows from the pair, so
 * the two stay consistent either way (model/shinuchi.ts). Import owns the song's
 * whole chart set, so difficulties the TJA does not supply get the corpus's
 * absent-chart sentinel rather than keeping a value that now describes no chart.
 */
export function shinutiPatch(imported: TjaImportResult): Record<ShinutiField, number> {
  const patch = {} as Record<ShinutiField, number>;
  const representative = representativeCharts(imported);
  for (const difficulty of DIFFICULTY_ORDER) {
    const chart = representative.get(difficulty);
    const scoring = chart
      ? shinuchiScoring(
        summarizeFumenMetadata(chart.fumen),
        difficulty,
        chart.shinutiBase > 0 ? chart.shinutiBase : undefined,
      )
      : { base: SHINUCHI_ABSENT, target: SHINUCHI_ABSENT };
    for (const field of SHINUTI_FIELDS[difficulty]) patch[field] = scoring.base;
    for (const field of SHINUTI_SCORE_FIELDS[difficulty]) patch[field] = scoring.target;
  }
  return patch;
}

/** Apply every metadata field owned by TJA import as one pure datatable transform. */
export function applyTjaImportMetadata(
  datatables: RawDatatables,
  uniqueId: number,
  songId: string,
  imported: TjaImportResult,
): RawDatatables {
  let next = datatables;
  for (const locale of LOCALES) {
    next = setTitle(next, songId, locale, imported.title[locale]);
    next = setSubtitle(next, songId, locale, imported.subtitle[locale]);
  }

  const representative = representativeCharts(imported);
  for (const difficulty of DIFFICULTY_ORDER) {
    next = setStar(next, uniqueId, STAR_FIELDS[difficulty], representative.get(difficulty)?.level ?? 0);
  }
  next = editMusicInfo(next, uniqueId, shinutiPatch(imported));

  const patch: MusicInfoChartDerivedPatch = {};
  for (const difficulty of DIFFICULTY_ORDER) {
    const fields = CHART_METADATA_FIELDS[difficulty];
    const chart = representative.get(difficulty);
    const summary = chart
      ? summarizeFumenMetadata(chart.fumen)
      : { branch: false, notes: 0, renda: 0, fuusen: 0 };
    assignDerived(patch, fields.branch, summary.branch);
    assignDerived(patch, fields.notes, summary.notes);
    assignDerived(patch, fields.renda, summary.renda);
    assignDerived(patch, fields.fuusen, summary.fuusen);
  }
  return syncChartMetadata(next, uniqueId, patch);
}

export interface TjaChartPreviewSummary {
  measures: number;
  notes: number;
  drumrolls: number;
  balloons: number;
}

export function summarizeImportedChart(fumen: Fumen): TjaChartPreviewSummary {
  let notes = 0;
  let drumrolls = 0;
  let balloons = 0;
  for (const measure of fumen.measures) {
    for (const branch of measure.branches) {
      for (const note of branch.notes) {
        notes++;
        if (note.type === 0x6 || note.type === 0x9) drumrolls++;
        else if (note.type === 0xa || note.type === 0xc) balloons++;
      }
    }
  }
  return { measures: fumen.measures.length, notes, drumrolls, balloons };
}
