// Central app state: browser support, the open project (handles + decoded
// datatables + song index), and current selection.
//
// Zustand store; the only things we persist are the directory handle
// (IndexedDB via fs/idb) and the display locale (localStorage, below).

import { create } from 'zustand';
import {
  BrowserSupport,
  detectBrowserSupport,
} from '../fs/support';
import {
  clearDaniFileHandle,
  clearProjectRootHandle,
  loadDaniFileHandle,
  loadProjectRootHandle,
  saveDaniFileHandle,
  saveProjectRootHandle,
} from '../fs/idb';
import {
  type OpenValidationError,
  openProjectWithKeys,
  pickProjectFolder,
  type ProjectKeys,
  ProjectRoot,
  queryRead,
  requestReadWrite,
} from '../fs/project';
import {
  DEFAULT_UI_LANG,
  detectDefaultUiLang,
  isUiLang,
  type UiLang,
} from '../i18n/messages';
import { loadDatatables, RawDatatables } from '../fs/datatables';
import { AssetInventory, loadAssetInventory } from '../fs/inventory';
import {
  FumenDifficulty,
  FumenPlayer,
  FumenSlot,
  listSongFumenSlots,
  loadFumen,
  LoadedFumen,
  parseFumenFilename,
  sortFumenSlots,
} from '../fs/fumens';
import {
  buildSongIndex,
  Locale,
  reindexSongOrder,
  SongFilter,
  SongIndex,
  songStars,
  SongSort,
  toggleSongFilter,
} from './songlist';
import {
  addBorder,
  addGaidenDan,
  addNormalDan,
  addOdaiSong,
  type BorderValueKey,
  clearDan,
  type DanSection,
  removeBorder,
  removeOdaiSong,
  removeTrailingDan,
  sameDanContentIgnoringVerup,
  scaffoldGaidenConfig,
  scaffoldNormalConfig,
  setBorderOdaiType,
  setBorderType,
  setBorderValue,
  setDanTitle,
  setOdaiSongHidden,
  setOdaiSongLevel,
  setOdaiSongNo,
} from './danEdits';
import { validateSection } from './danValidation';
import { makeDanSongResolver } from './danCatalog';
import { parseDanConfig, type DanConfig } from '../codec/serverdata';
import {
  canOpenDaniFile,
  DaniPermissionError,
  type DaniFileError,
  openDanFile,
  queryDaniReadPermission,
  saveDanFile,
  saveDanFileAs,
} from '../fs/danFile';
import {
  editMusicInfo as editMusicInfoFields,
  syncChartMetadata,
  setStar,
  setUraEnabled as editUraEnabled,
  setTitle,
  setSubtitle,
  reorderMusicOrder,
  sortMusicOrderGenre,
  insertMusicOrderEntry,
  removeMusicOrderEntry,
  addSong as editsAddSong,
  deleteSong as editsDeleteSong,
  NewSong,
  StarField,
} from './edits';
import {
  ChartMeasureRef,
  ChartNoteRef,
  ChartTool,
  FumenHeaderPatch,
  insertChartNote,
  NotePositionPolicy,
  PlaceChartNoteInput,
  removeChartNote,
  removeChartNotes,
  seedBranchesFromNormal,
  setBranchSpeedOverride,
  setChartAudioOffset,
  setMeasureBarline as editMeasureBarline,
  setMeasureBpmOverride,
  setMeasureBranchInfo as editMeasureBranchInfo,
  setMeasureDuration as editMeasureDuration,
  setMeasureGogo as editMeasureGogo,
  SpeedTarget,
  updateChartNote,
  updateFumenHeader,
  type BranchInfo,
} from './fumenEdits';
import type { Fumen, FumenNote, MusicInfoChartDerivedPatch, MusicInfoEditablePatch } from '../codec';
import { adjacentNote, firstNoteInMeasure } from './fumenNavigation';
import { CHART_METADATA_FIELDS, chartMetadataPatchAfterEdit, clonedDifficultyMetadataPatch } from './fumenMetadata';

/** Branch-editing focus: 'all' or one of the three branch tracks. */
export type BranchFocus = 'all' | 0 | 1 | 2;
import { diffDatatables, ProjectDiff } from './diff';
import { scopedDatatables, orderScopeDirty, songsDatatableDirty, type SaveScope } from './saveScope';
import {
  collectFumenDiffs,
  FumenBaseline,
  FumenFileDiff,
  fumenKey,
} from './fumenDrafts';
import {
  collectSoundMetadataDiffs,
  SoundMetadataBaseline,
  SoundMetadataDraft,
  soundMetadataKey,
} from './soundMetadata';
import {
  cloneFumen,
  CreatedFumen,
  mergeSongSlots,
  RemovedFumenSlot,
  uraSlotForOni,
} from './fumenSlots';
import {
  blankFumenSlotSet,
  chartScoringOrDefault,
  readChartScoring,
  refreshChartDerivedHeader,
  stampChartScoring,
  withScoreCeiling,
} from './fumenScaffold';
import { validate, ValidationIssue, ValidationResult } from './validation';
import { validateDirtyFumens, validateFumenChart } from './fumenValidation';
import { DirtyFumenInput, DirtySoundBankInput, RemovedFumenInput, saveDatatables, SaveResult } from '../fs/write';
import {
  readSoundBankBytes,
  removeSoundFile,
  replaceSoundFile,
  resolveSoundFile,
  SoundWriteResult,
} from '../fs/sound';
import { readNus3BankDemoStartMs } from '../codec';
import {
  applyTjaImportMetadata,
  DEFAULT_TJA_IMPORT_OPTIONS,
  importChartSlot,
  type TjaImportOptions,
  type TjaImportResult,
} from './tjaImport';

export type Area = 'songs' | 'order' | 'dani';
export type EditorTab = 'metadata' | 'chart' | 'sound';
const HISTORY_LIMIT = 200;
const DANI_HISTORY_LIMIT = 100;

/**
 * A song's star rating for one difficulty, which keys the authored soul gauge.
 * `undefined` when the difficulty is unrated, so the gauge falls back to the
 * difficulty's corpus norm rather than to star 0.
 */
function songStarFor(
  project: { songs: SongIndex },
  uniqueId: number,
  difficulty: FumenDifficulty,
): number | undefined {
  const row = project.songs.byUniqueId.get(uniqueId);
  const star = row ? songStars(row)[difficulty] : 0;
  return star > 0 ? star : undefined;
}

// ── Dani Dojo (段位道場) — a self-contained slice ────────────────────────────
// Independent of the game project: its own file handles, drafts, undo/redo, and
// save state (see PLAN.md, Dani Dojo). Two file slots, mirroring the two real server
// files: `normal` = dan_data.json, `gaiden` = gaiden_data.json.
export type { DanSection } from './danEdits';

export interface DaniFileSlot {
  loaded: boolean;
  /** Display file name (the picked handle's name, or the New default). */
  fileName: string;
  /** Bound file handle; undefined for a New file until its first Save. */
  handle?: FileSystemFileHandle;
  /** Last-loaded/saved config on disk — the diff + undo floor. */
  baseline: DanConfig;
  /** Working copy the UI edits. */
  draft: DanConfig;
  undo: DanConfig[];
  redo: DanConfig[];
}

export interface DaniSelection {
  section: DanSection;
  danId: number;
}

export interface DaniPicker {
  section: DanSection;
  danId: number;
  slot: number;
  query: string;
}

export interface DaniState {
  normal: DaniFileSlot;
  gaiden: DaniFileSlot;
  sel?: DaniSelection;
  picker?: DaniPicker;
  /** Which section's save modal is open, if any. */
  saveOpen?: DanSection;
  saving: boolean;
  /** Transient error (load/save) surfaced in the tab, cleared on next action. */
  error?: string;
}

function emptyDaniSlot(fileName: string): DaniFileSlot {
  return { loaded: false, fileName, baseline: [], draft: [], undo: [], redo: [] };
}

function daniErrorMessage(e: DaniFileError): string {
  switch (e.kind) {
    case 'cancelled': return 'Cancelled.';
    case 'unsupported': return e.reason;
    case 'read': return `Couldn't read the file: ${e.reason}`;
    case 'parse': return `Couldn't parse the file: ${e.reason}`;
    case 'permission': return e.reason;
  }
}

/**
 * verupNo auto-bump policy (see PLAN.md, Dani Dojo). After a content edit to one
 * dan: keep verupNo == baseline while the content matches baseline (so a
 * reverted edit fully reverts), else ensure verupNo ≥ baseline+1 so the game
 * client re-fetches. New dans (no baseline entry) are left at their seeded
 * verupNo.
 */
function autoBumpVerup(config: DanConfig, baseline: DanConfig, danId: number): DanConfig {
  const base = baseline.find((d) => d.danId === danId);
  if (!base) return config;
  return config.map((d) => {
    if (d.danId !== danId) return d;
    if (sameDanContentIgnoringVerup(d, base)) {
      return d.verupNo === base.verupNo ? d : { ...d, verupNo: base.verupNo };
    }
    return d.verupNo > base.verupNo ? d : { ...d, verupNo: base.verupNo + 1 };
  });
}

function cappedPush(stack: DanConfig[], item: DanConfig): DanConfig[] {
  const next = [...stack, item];
  if (next.length > DANI_HISTORY_LIMIT) next.shift();
  return next;
}

/** Keep a selection valid after an undo/redo may have dropped the selected dan. */
function clampDaniSel(sel: DaniSelection | undefined, section: DanSection, config: DanConfig): DaniSelection | undefined {
  if (!sel || sel.section !== section) return sel;
  if (config.some((d) => d.danId === sel.danId)) return sel;
  return config.length ? { section, danId: config[config.length - 1].danId } : undefined;
}

// The song-title display locale follows the editor UI language — there is a
// single language control (the global picker). Korean has no UI-language
// counterpart, so it is only reachable as an editable field on the Metadata tab,
// not as the list-display locale.
const SONG_LOCALE_BY_UI_LANG: Record<UiLang, Locale> = {
  en: 'englishUsText',
  ja: 'japaneseText',
  'zh-Hans': 'chineseSText',
  'zh-Hant': 'chineseTText',
};

function songLocaleForUiLang(l: UiLang): Locale {
  return SONG_LOCALE_BY_UI_LANG[l];
}

// Editor UI language (drives both the UI strings and the song-title locale above).
// Persisted to localStorage; falls back to the browser language, then English.
// index.html mirrors the same key onto <html lang> pre-paint — keep the key in sync.
const UI_LANG_STORAGE_KEY = 'tk-ui-lang';

function loadStoredUiLang(): UiLang {
  try {
    const v = localStorage.getItem(UI_LANG_STORAGE_KEY);
    if (isUiLang(v)) return v;
  } catch {
    // ignore — fall through to browser detection
  }
  return detectDefaultUiLang() ?? DEFAULT_UI_LANG;
}

function persistUiLang(l: UiLang): void {
  try {
    localStorage.setItem(UI_LANG_STORAGE_KEY, l);
  } catch {
    // ignore — persistence is best-effort
  }
}

function applyDocumentLang(l: UiLang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

// The two AES keys the user pastes to open a project. Remembered (localStorage)
// so returning users don't re-paste on every open/reconnect — mirrors how the
// folder handle is remembered. Empty strings on a first-ever visit.
const KEYS_STORAGE_KEY = 'tk-project-keys';

function loadStoredKeys(): ProjectKeys {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectKeys>;
      return {
        datatable: typeof parsed.datatable === 'string' ? parsed.datatable : '',
        fumen: typeof parsed.fumen === 'string' ? parsed.fumen : '',
      };
    }
  } catch {
    // ignore — fall through to empty
  }
  return { datatable: '', fumen: '' };
}

function persistKeys(keys: ProjectKeys): void {
  try {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // ignore — persistence is best-effort
  }
}

/** Do we have two remembered keys good enough to try a silent reconnect? */
function hasStoredKeys(keys: ProjectKeys): boolean {
  return keys.datatable.trim().length > 0 && keys.fumen.trim().length > 0;
}

// Light/dark theme. Persisted to localStorage and reflected on the document root
// as [data-theme], which the CSS tokens key off (see styles/tokens.css). index.html
// applies the saved value before first paint to avoid a flash — keep the key in sync.
export type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'tk-theme';
const DEFAULT_THEME: Theme = 'light';

function loadStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // ignore — fall through to default
  }
  return DEFAULT_THEME;
}

function persistTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    // ignore — persistence is best-effort
  }
}

function applyThemeToDocument(t: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
}

// The About dialog doubles as the welcome screen: it opens by itself the first
// time Bachi runs in this browser, and a flag here keeps it from reappearing.
// Best-effort like the other preferences — a browser that denies storage just
// gets the welcome each visit, which is harmless.
const WELCOME_SEEN_STORAGE_KEY = 'tk-welcome-seen';

function loadWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
  } catch {
    // ignore — persistence is best-effort
  }
}

/**
 * One point on the undo timeline. Both datatable edits and chart edits push a
 * snapshot, so ⌘Z walks them in one combined history. Structural sharing keeps
 * each snapshot cheap — only the touched table or chart is a new reference.
 */
export interface HistorySnapshot {
  datatables: RawDatatables;
  fumenDrafts: Map<string, Fumen>;
  /** Charts pending creation (new files), keyed by `<songId>/<filename>`. */
  fumenCreated: Map<string, CreatedFumen>;
  /** Chart files pending removal, keyed by `<songId>/<filename>`. */
  fumenRemoved: Map<string, RemovedFumenSlot>;
  /** Sound-bank metadata edits pending save, keyed by sound filename. */
  soundMetadataDrafts: Map<string, SoundMetadataDraft>;
}

export interface OpenProject {
  root: ProjectRoot;
  /** The decoded datatables as loaded from disk — never mutated; the undo floor. */
  baseline: RawDatatables;
  /** The working copy the UI reads and edits (structurally shared with baseline). */
  datatables: RawDatatables;
  /** Canonical song rows plus a separate music_order projection. */
  songs: SongIndex;
  /** Which fumen/sound assets actually exist on disk (for missing-asset flags). */
  assets: AssetInventory;
  /** Charts as first decoded from disk — the diff floor. Append-only on load. */
  fumenBaselines: Map<string, FumenBaseline>;
  /** Charts the user has edited, keyed by `<songId>/<filename>`. */
  fumenDrafts: Map<string, Fumen>;
  /** Charts pending creation as new files (e.g. a new Ura triple). */
  fumenCreated: Map<string, CreatedFumen>;
  /** Existing chart files pending removal (e.g. a deleted Ura). */
  fumenRemoved: Map<string, RemovedFumenSlot>;
  /** Sound-bank metadata as first read from disk. */
  soundMetadataBaselines: Map<string, SoundMetadataBaseline>;
  /** Sound-bank metadata edits pending save. */
  soundMetadataDrafts: Map<string, SoundMetadataDraft>;
  undo: HistorySnapshot[];
  redo: HistorySnapshot[];
}

function makeOpenProject(root: ProjectRoot, datatables: RawDatatables, assets: AssetInventory): OpenProject {
  return {
    root,
    baseline: datatables,
    datatables,
    songs: buildSongIndex(datatables),
    assets,
    fumenBaselines: new Map(),
    fumenDrafts: new Map(),
    fumenCreated: new Map(),
    fumenRemoved: new Map(),
    soundMetadataBaselines: new Map(),
    soundMetadataDrafts: new Map(),
    undo: [],
    redo: [],
  };
}

/** Keep canonical song rows stable when only music_order changed. */
function songIndexAfterDatatableChange(
  current: SongIndex,
  before: RawDatatables,
  after: RawDatatables,
): SongIndex {
  if (after.musicinfo !== before.musicinfo || after.wordlist !== before.wordlist) {
    return buildSongIndex(after);
  }
  if (after.musicOrder === before.musicOrder) return current;
  return reindexSongOrder(current, after.musicOrder.items);
}

export type ProjectStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'needs-permission'; handle: FileSystemDirectoryHandle }
  | { kind: 'open'; project: OpenProject }
  | { kind: 'error'; message: string };

export type FumenLoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; songId: string; slot: FumenSlot }
  | { kind: 'ready'; loaded: LoadedFumen }
  | { kind: 'error'; songId: string; slot: FumenSlot; message: string };

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done'; result: SaveResult }
  | { kind: 'error'; message: string };

/**
 * Transient state for the "open a project" Settings form: the picked
 * (or remembered) folder, the two pasted keys, busy, and the last validation
 * error. Lives in the store — not component state — so the form survives the
 * async open probe and an error preserves what the user typed.
 */
export interface ProjectSetup {
  handle?: FileSystemDirectoryHandle;
  folderName?: string;
  /** True when `handle` came from a remembered folder (may need a permission re-grant). */
  remembered: boolean;
  datatableKey: string;
  fumenKey: string;
  busy: boolean;
  /** The last failed-open reason — rendered as the inline "breadcrust". */
  error?: OpenValidationError;
}

interface AppState {
  support: BrowserSupport;
  project: ProjectStatus;
  selection: {
    songId?: string;
    difficulty: FumenDifficulty;
    player: FumenPlayer;
  };
  chart: {
    tool: ChartTool;
    selectedNote?: ChartNoteRef;
    /** Multi-selection from a drag-rect marquee (Select tool). */
    selectedNotes?: ChartNoteRef[];
    /** Measure-first event editing (Phase 11): the selected measure, if any. */
    selectedMeasure?: ChartMeasureRef;
    /** Branch-editing focus: 'all' edits every track; a number isolates one. */
    branchFocus: BranchFocus;
  };
  ui: {
    locale: Locale;
    /** Editor UI language (distinct from `locale`, which is the song-title locale). */
    uiLang: UiLang;
    /** Light/dark UI theme; mirrored onto the document root as [data-theme]. */
    theme: Theme;
    search: string;
    area: Area;
    tab: EditorTab;
    /** Score-canvas horizontal (timeline) zoom multiplier; shared by the Chart and Sound tabs. */
    zoom: number;
    /** Score-canvas vertical note/row scale (0.1–2); shared by the Chart and Sound tabs. */
    noteScale: number;
    /** Active Songs-catalog filters; an empty array shows every song. */
    filters: SongFilter[];
    /** Ordering applied to the Songs catalog only. */
    songSort: SongSort;
    saveDialogOpen: boolean;
    /** Which page's edits the open save dialog is reviewing. */
    saveScope?: SaveScope;
    exportDialogOpen: boolean;
    /** Application settings modal (project folder/keys + optional decoder). */
    settingsOpen: boolean;
    /** About / welcome modal; opens by itself on a first run. */
    aboutOpen: boolean;
    /** Bumped after the optional G.719 binary changes so an open Sound tab retries. */
    g719DecoderRevision: number;
    addSongOpen: boolean;
    /** uniqueId of the song pending delete-confirmation, or undefined. */
    deleteSongId?: number;
    tjaImportOpen: boolean;
  };
  /** Slots available for the selected song (disk slots merged with pending create/delete). */
  songSlots?: FumenSlot[];
  /** The selected song's slots as read from disk — the floor that create/delete merge against. */
  songDiskSlots?: FumenSlot[];
  fumen: FumenLoadState;
  save: SaveStatus;
  dani: DaniState;
  setup: ProjectSetup;

  initFromStoredHandle: () => Promise<void>;
  // ── Project open flow (Settings) ─────────────────────────
  /** Step 1: show the OS folder picker and remember the chosen folder. */
  setupPickFolder: () => Promise<void>;
  /** Step 2: update one of the two pasted keys (clears the error). */
  setupSetKey: (which: 'datatable' | 'fumen', value: string) => void;
  /** Step 3: validate the folder + keys, then open (or set setup.error). */
  setupOpenProject: () => Promise<void>;
  reconnect: () => Promise<void>;
  forgetProject: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  openAbout: () => void;
  /** Close About and remember it, so the welcome only shows once. */
  closeAbout: () => void;
  notifyG719DecoderChanged: () => void;
  setSearch: (q: string) => void;
  /** Set the editor UI language (persisted, reflected on <html lang>, drives the song-title locale). */
  setUiLang: (l: UiLang) => void;
  /** Set the light/dark theme (persisted + applied to the document root). */
  setTheme: (t: Theme) => void;
  /** Flip between light and dark. */
  toggleTheme: () => void;
  setArea: (a: Area) => void;
  setTab: (t: EditorTab) => void;
  /** Set the shared score-canvas timeline (horizontal) zoom multiplier (Chart + Sound tabs). */
  setZoom: (zoom: number) => void;
  /** Set the shared score-canvas note/row scale, clamped to 0.5–2 (Chart + Sound tabs). */
  setNoteScale: (noteScale: number) => void;
  toggleSongFilter: (filter: SongFilter) => void;
  setSongSort: (sort: SongSort) => void;
  selectSong: (id: string) => Promise<void>;
  selectFumen: (difficulty: FumenDifficulty, player: FumenPlayer) => Promise<void>;

  // ── Editing ──────────────────────────────────────────────
  editMusicInfo: (uniqueId: number, patch: MusicInfoEditablePatch) => void;
  editStar: (uniqueId: number, field: StarField, value: number) => void;
  /** Enable/disable Ura metadata without creating or deleting chart files. */
  setUraEnabled: (uniqueId: number, on: boolean) => void;
  /**
   * Toggle branching for one difficulty from the Metadata tab. Patches the
   * `hasBranches` header flag on every player chart of that difficulty (loading
   * any not in memory) — the same edit the chart Inspector's Branched-chart
   * toggle makes — so the two stay in lockstep, and syncs the derived musicinfo
   * `branch*` flag. Async because a slot may need a disk read.
   */
  setDifficultyBranch: (uniqueId: number, difficulty: FumenDifficulty, on: boolean) => Promise<void>;
  /** Create Ura chart files from Oni; invoked only from the chart editor. */
  createUraChart: (uniqueId: number) => Promise<void>;
  /** Remove Ura chart files without changing whether Ura metadata is enabled. */
  deleteUraChart: (uniqueId: number) => void;
  /** Create a blank chart (all three player slots) for a difficulty the song
   *  doesn't yet have — the "author a chart from scratch" entry point. */
  addBlankDifficulty: (uniqueId: number, difficulty: FumenDifficulty) => Promise<void>;
  /** Remember the sound bank's disk-backed demo-start value after the Sound tab parses it. */
  rememberSoundBankMetadata: (input: Omit<SoundMetadataBaseline, 'key'>) => void;
  /** Edit the sound bank's game-backed demo-start value; saved through commitSave. */
  editSoundBankDemoStart: (input: Omit<SoundMetadataDraft, 'key'>) => void;
  editTitle: (songId: string, locale: Locale, value: string) => void;
  editSubtitle: (songId: string, locale: Locale, value: string) => void;
  /**
   * Move the dragged card from slot `fromIndex` of `fromGenreNo`'s folder to
   * slot `toIndex` of `toGenreNo`'s folder. Addressing the source by folder+slot
   * (not id) moves the right copy when a song appears in multiple genres.
   */
  reorderSong: (
    songId: string,
    fromGenreNo: number,
    fromIndex: number,
    toGenreNo: number,
    toIndex: number,
  ) => void;
  /** Sort one music-order genre folder by the displayed locale title. */
  sortOrderGenre: (genreNo: number, locale: Locale) => void;
  /** Add a song placement at the top of a music-order genre folder. */
  addSongToOrder: (genreNo: number, uniqueId: number) => void;
  /** Remove the placement addressed by (folder, folder-local index) from music_order. */
  removeSongFromOrder: (songId: string, genreNo: number, index: number) => void;
  /** Switch to the Songs area and open `songId` in the editor. */
  revealSongInEditor: (songId: string) => void;
  /** Scaffold a new song, then select it on the Metadata tab. */
  addSong: (song: NewSong) => void;
  /** Remove a song from all datatables (its files are cleaned up on save). */
  deleteSong: (uniqueId: number) => void;
  /** Immediately replace a song's .nus3bank file on disk. */
  replaceSongAudio: (uniqueId: number, file: File) => Promise<SoundWriteResult>;
  /** Immediately remove a song's .nus3bank file from disk. */
  removeSongAudio: (uniqueId: number) => Promise<SoundWriteResult>;
  undo: () => void;
  redo: () => void;

  // ── Fumen editing (drafts persist across slot switches; saved in commitSave) ─
  setChartTool: (tool: ChartTool) => void;
  /** Set the branch-editing focus (branched charts only). */
  setBranchFocus: (focus: BranchFocus) => void;
  selectChartNote: (ref?: ChartNoteRef) => void;
  /** Replace the marquee multi-selection (Select tool drag-rect). */
  selectChartNotes: (refs: ChartNoteRef[]) => void;
  /** Select a measure (or clear with undefined) for measure-first editing. */
  selectChartMeasure: (ref?: ChartMeasureRef) => void;
  /** Navigate the current single note/measure selection with the arrow keys. */
  navigateChartSelection: (key: 'left' | 'right' | 'toggle') => void;
  placeChartNote: (input: PlaceChartNoteInput) => void;
  eraseChartNote: (ref: ChartNoteRef) => void;
  /** Delete every note in the current single/marquee selection. */
  eraseSelectedChartNotes: () => void;
  updateSelectedChartNote: (patch: Partial<FumenNote>) => void;
  // ── Measure-level edits (Phase 11) — operate on a measure index directly ──
  /** "BPM changes here" override; on:false copies the previous measure's BPM. */
  setMeasureBpm: (measureIndex: number, on: boolean, value?: number) => void;
  /** Scroll-speed override for a branch stave (or 'all'); on:false inherits prev. */
  setMeasureSpeed: (measureIndex: number, target: SpeedTarget, on: boolean, value?: number) => void;
  /** Toggle GO-GO time on a measure. */
  setMeasureGogo: (measureIndex: number, on: boolean) => void;
  /** Toggle a measure's barline. */
  setMeasureBarline: (measureIndex: number, on: boolean) => void;
  /** Replace a measure's 6 branch thresholds. */
  setMeasureBranchInfo: (measureIndex: number, branchInfo: BranchInfo) => void;
  /** Edit a measure's real duration (ms), rippling downstream offsets (Phase 12). */
  setMeasureDuration: (measureIndex: number, newDurationMs: number, policy?: NotePositionPolicy) => void;
  /**
   * Set the first-measure delay/offset from the Sound tab. The offset is
   * authored identically across every difficulty + player chart of a song, so
   * this propagates the value to ALL of the song's fumen slots (loading any not
   * yet in memory) as one undo step, keeping them in lockstep on disk.
   */
  editCurrentFumenOffset: (offsetMs: number) => void;
  /** Edit the loaded chart's typed header (gauge/HP, branch scoring, hasBranches). */
  updateChartHeader: (patch: FumenHeaderPatch) => void;
  /** Author a branch on the loaded flat chart: set hasBranches + seed E/M from Normal. */
  seedChartBranches: () => void;
  /** Set the chart-wide legacy score base (初項) / step (公差): re-stamps every note
   *  and recomputes the score ceiling. Works on any chart with notes. */
  setChartScoring: (base: number, step: number) => void;

  // ── Add / delete dialogs ─────────────────────────────────
  openAddSong: () => void;
  closeAddSong: () => void;
  openDeleteSong: (uniqueId: number) => void;
  closeDeleteSong: () => void;
  openTjaImport: () => void;
  closeTjaImport: () => void;
  /** Apply the chosen parts of a TJA — metadata, the full chart set, and/or the
   *  sound bank's demo start — to the selected song in one undo step. */
  importTja: (
    uniqueId: number,
    imported: TjaImportResult,
    options?: TjaImportOptions,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;

  // ── Save ─────────────────────────────────────────────────
  openSaveDialog: (scope: SaveScope) => void;
  closeSaveDialog: () => void;
  openExportDialog: () => void;
  closeExportDialog: () => void;
  commitSave: (scope: SaveScope) => Promise<void>;
  /** True when the Songs page (musicinfo/wordlist/fumen/sound) has unsaved edits. */
  isSongsDirty: () => boolean;
  /** True when the Music Order page (music_order.bin) has unsaved edits. */
  isOrderDirty: () => boolean;

  // ── Dani Dojo (standalone file editor) ───────────────────
  /** Whether the browser can open a dani file (Chromium file picker). */
  canOpenDani: () => boolean;
  /** Reopen the last-used dani files from IndexedDB (permission-gated). */
  daniInitFromStorage: () => Promise<void>;
  daniLoad: (section: DanSection) => Promise<void>;
  daniNew: (section: DanSection) => void;
  /** Close one file slot and forget its persisted handle. */
  daniClose: (section: DanSection) => void;
  daniSelectDan: (section: DanSection, danId: number) => void;
  daniSetGaidenTitle: (danId: number, title: string) => void;
  daniSetCourse: (section: DanSection, danId: number, slot: number, level: number) => void;
  daniSetHidden: (section: DanSection, danId: number, slot: number, hidden: boolean) => void;
  daniAddBorder: (section: DanSection, danId: number) => void;
  daniRemoveBorder: (section: DanSection, danId: number, borderIndex: number) => void;
  daniSetBorderType: (section: DanSection, danId: number, borderIndex: number, borderType: number) => void;
  daniSetBorderOdaiType: (section: DanSection, danId: number, borderIndex: number, odaiType: number) => void;
  daniSetBorderValue: (section: DanSection, danId: number, borderIndex: number, key: BorderValueKey, value: number) => void;
  daniClearDan: (section: DanSection, danId: number) => void;
  daniAddDan: (section: DanSection) => void;
  daniRemoveDan: (section: DanSection) => void;
  daniUndo: () => void;
  daniRedo: () => void;
  daniSetSongNo: (section: DanSection, danId: number, slot: number, songNo: number) => void;
  daniAddSong: (section: DanSection, danId: number) => void;
  daniRemoveSong: (section: DanSection, danId: number, slot: number) => void;
  daniOpenPicker: (section: DanSection, danId: number, slot: number) => void;
  daniClosePicker: () => void;
  daniSetPickerQuery: (query: string) => void;
  daniPickSong: (songNo: number) => void;
  daniOpenSave: (section: DanSection) => void;
  daniCloseSave: () => void;
  daniCommitSave: () => Promise<void>;

  // ── Derived selectors ────────────────────────────────────
  getDiff: () => ProjectDiff | undefined;
  getFumenDiffs: () => FumenFileDiff[];
  /** Total unsaved edits across datatables + charts. */
  getEditCount: () => number;
  getValidation: () => ValidationResult | undefined;
  /** Chart-invariant issues for the dirty charts (PLAN 3.7); [] when none. */
  getFumenValidation: () => ValidationIssue[];
}

async function openProjectFromRoot(root: ProjectRoot): Promise<OpenProject> {
  const [datatables, assets] = await Promise.all([loadDatatables(root), loadAssetInventory(root)]);
  return makeOpenProject(root, datatables, assets);
}

/**
 * Open a remembered folder + keys silently (init / reconnect). On success it
 * (re)persists the handle and keys; on failure it returns the field-specific
 * validation error so the caller can drop the user into the setup form.
 */
async function openRememberedProject(
  handle: FileSystemDirectoryHandle,
  keys: ProjectKeys,
): Promise<{ ok: true; project: OpenProject } | { ok: false; error: OpenValidationError }> {
  const res = await openProjectWithKeys(handle, keys);
  if (!res.ok) return res;
  const project = await openProjectFromRoot(res.root);
  await saveProjectRootHandle(res.root.handle);
  if (res.root.keys) persistKeys(res.root.keys);
  return { ok: true, project };
}

export const useAppStore = create<AppState>((set, get) => {
  /** Snapshot the current edit state for the undo stack (bounded to HISTORY_LIMIT). */
  const pushHistory = (p: OpenProject): HistorySnapshot[] => {
    const undo = [
      ...p.undo,
      {
        datatables: p.datatables,
        fumenDrafts: p.fumenDrafts,
        fumenCreated: p.fumenCreated,
        fumenRemoved: p.fumenRemoved,
        soundMetadataDrafts: p.soundMetadataDrafts,
      },
    ];
    if (undo.length > HISTORY_LIMIT) undo.shift();
    return undo;
  };

  /**
   * Apply a pure datatable transform to the working draft, pushing a history
   * snapshot (structural sharing keeps this cheap) and clearing redo. A no-op
   * transform (same reference back) is ignored.
   */
  const applyEdit = (producer: (d: RawDatatables) => RawDatatables): void => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    const next = producer(p.datatables);
    if (next === p.datatables) return;
    set({
      project: {
        kind: 'open',
        project: {
          ...p,
          datatables: next,
          songs: songIndexAfterDatatableChange(p.songs, p.datatables, next),
          undo: pushHistory(p),
          redo: [],
        },
      },
      save: { kind: 'idle' },
    });
  };

  /**
   * Apply a pure chart transform to the currently-displayed fumen. The result is
   * stored in fumenDrafts (so it survives a slot switch) and mirrored into the
   * ready `fumen` state (so the canvas re-renders). Pushes a history snapshot
   * only when the chart bytes actually changed. Returns the transform result so
   * callers can update the chart selection.
   */
  const applyFumenEdit = (transform: (fumen: Fumen) => { fumen: Fumen }): { fumen: Fumen } | undefined => {
    const cur = get().fumen;
    if (cur.kind !== 'ready') return undefined;
    const proj = get().project;
    if (proj.kind !== 'open') return undefined;
    const p = proj.project;
    const before = cur.loaded.fumen;
    const result = transform(before);
    if (result.fumen === before) return result; // selection-only change
    const key = fumenKey(cur.loaded.songId, cur.loaded.filename);
    // Keep the chart's score base/step uniform and its ceiling (dummyData) correct
    // after any note edit — every chart, so a from-scratch chart stays consistent
    // even after it's been saved and reopened (when it can no longer be told apart
    // from a shipped one). Re-stamp with the chart's OWN base/step (read off the
    // pre-edit chart, so a just-placed 0-value note inherits it), not the default.
    // The soul gauge is only *auto-scaled* while a chart is freshly authored, to
    // avoid overwriting a shipped chart's hand-tuned gauge on a light edit.
    // The metadata patch is computed from `result`: stamping changes only scores,
    // never note counts, and preserves note order so the returned `selection` holds.
    const scoring = chartScoringOrDefault(before);
    const row = p.songs.byId.get(cur.loaded.songId);
    const stored = p.fumenCreated.has(key)
      ? refreshChartDerivedHeader(
        result.fumen,
        cur.loaded.difficulty,
        scoring,
        row && songStarFor(p, row.uniqueId, cur.loaded.difficulty),
      )
      : withScoreCeiling(stampChartScoring(result.fumen, scoring));
    const fumenDrafts = new Map(p.fumenDrafts);
    fumenDrafts.set(key, stored);
    let datatables = p.datatables;
    if (row) {
      const metadataPatch = chartMetadataPatchAfterEdit(row.info, cur.loaded.difficulty, before, result.fumen);
      datatables = syncChartMetadata(datatables, row.uniqueId, metadataPatch);
    }
    set({
      project: {
        kind: 'open',
        project: {
          ...p,
          datatables,
          songs: songIndexAfterDatatableChange(p.songs, p.datatables, datatables),
          fumenDrafts,
          undo: pushHistory(p),
          redo: [],
        },
      },
      fumen: { kind: 'ready', loaded: { ...cur.loaded, fumen: stored } },
      save: { kind: 'idle' },
    });
    return result;
  };

  /**
   * After an undo/redo reinstates `fumenDrafts`, re-point the displayed chart at
   * whatever that slot now holds (its draft, or its baseline if the edit that
   * created the draft was undone). Selection is cleared because note indices may
   * no longer be valid.
   */
  const refreshFumenAfterHistory = (p: OpenProject): void => {
    // Create/delete may have been un/redone — re-merge the visible song's slots.
    const songId = get().selection.songId;
    let merged: FumenSlot[] | undefined;
    if (songId) {
      const diskSlots = get().songDiskSlots ?? [];
      const visibleSlots = get().songSlots ?? [];
      const slotsBelongToSong = [...diskSlots, ...visibleSlots]
        .some((slot) => parseFumenFilename(songId, slot.filename) !== undefined);
      const hasPendingSlots = [...p.fumenCreated.values()].some((value) => value.songId === songId)
        || [...p.fumenRemoved.values()].some((value) => value.songId === songId);
      // Slot caches are transient and can briefly lag a selection update. Only
      // merge them when they describe this song or its history changes do.
      if (slotsBelongToSong || hasPendingSlots) {
        merged = mergeSongSlots(diskSlots, songId, p.fumenCreated, p.fumenRemoved);
        set({ songSlots: merged });
      }
    }
    const cur = get().fumen;
    if (cur.kind !== 'ready') return;
    if (merged && cur.loaded.songId === songId && !merged.some((slot) => slot.filename === cur.loaded.filename)) {
      const selection = get().selection;
      const fallback = merged.find((slot) =>
        slot.difficulty === selection.difficulty && slot.player === selection.player)
        ?? merged.find((slot) => slot.difficulty === selection.difficulty)
        ?? merged[0];
      if (fallback) void get().selectFumen(fallback.difficulty, fallback.player);
      else set({ fumen: { kind: 'idle' } });
      return;
    }
    const key = fumenKey(cur.loaded.songId, cur.loaded.filename);
    const fumen = p.fumenDrafts.get(key)
      ?? p.fumenCreated.get(key)?.fumen
      ?? p.fumenBaselines.get(key)?.fumen
      ?? cur.loaded.fumen;
    if (fumen === cur.loaded.fumen) return;
    set({
      fumen: { kind: 'ready', loaded: { ...cur.loaded, fumen } },
      chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined },
    });
  };

  /**
   * Create a song's Ura by cloning its Oni slot(s) into the matching `_x` files
   * in one undo step. Chart creation is independent of metadata enablement:
   * the Ura chart can be authored while `starUra` is still 0 (the DiffTabs pill
   * then warns that it also needs enabling in Metadata to be playable in-game).
   * Async because the Oni charts may need a disk read.
   */
  const createUra = async (uniqueId: number): Promise<void> => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const row = cur.project.songs.byUniqueId.get(uniqueId);
    const songId = row?.id;
    if (!songId) return;

    // Re-enabling an Ura whose deletion is still pending (off→on before a save):
    // cancel the removal so the original chart is kept, rather than re-cloning Oni.
    const p0 = cur.project;
    const pendingUraRemovals = [...p0.fumenRemoved].filter(
      ([, r]) => r.songId === songId && parseFumenFilename(songId, r.filename)?.difficulty === 'ura',
    );
    if (pendingUraRemovals.length > 0) {
      const fumenRemoved = new Map(p0.fumenRemoved);
      for (const [key] of pendingUraRemovals) fumenRemoved.delete(key);
      set({
        project: {
          kind: 'open',
          project: { ...p0, fumenRemoved, undo: pushHistory(p0), redo: [] },
        },
        save: { kind: 'idle' },
      });
      if (get().selection.songId === songId) {
        const merged = mergeSongSlots(get().songDiskSlots ?? [], songId, p0.fumenCreated, fumenRemoved);
        set({ songSlots: merged });
        const firstUra = merged.find((s) => s.difficulty === 'ura');
        if (firstUra) await get().selectFumen('ura', firstUra.player);
      }
      return;
    }

    const slots = get().songSlots ?? [];
    const oniSlots = slots.filter((s) => s.difficulty === 'oni');
    const hasUra = slots.some((s) => s.difficulty === 'ura');
    if (hasUra) return;
    if (oniSlots.length === 0) return; // nothing to clone from

    // Load + deep-clone each Oni slot into its Ura counterpart.
    const created: CreatedFumen[] = [];
    for (const oni of oniSlots) {
      const key = fumenKey(songId, oni.filename);
      let fumen = cur.project.fumenDrafts.get(key) ?? cur.project.fumenBaselines.get(key)?.fumen;
      if (!fumen) {
        try {
          fumen = (await loadFumen(cur.project.root, songId, oni)).fumen;
        } catch {
          continue; // unreadable Oni slot — skip it
        }
      }
      created.push({ songId, slot: uraSlotForOni(songId, oni), fumen: cloneFumen(fumen) });
    }
    if (created.length === 0) return;

    // Re-read state (the awaits may have raced with other edits) and commit.
    const cur2 = get().project;
    if (cur2.kind !== 'open') return;
    const p2 = cur2.project;
    const undo = pushHistory(p2);
    const fumenCreated = new Map(p2.fumenCreated);
    const fumenRemoved = new Map(p2.fumenRemoved);
    for (const c of created) {
      const key = fumenKey(c.songId, c.slot.filename);
      fumenCreated.set(key, c);
      fumenRemoved.delete(key); // re-create cancels a pending removal
    }
    const sourceInfo = p2.songs.byUniqueId.get(uniqueId)?.info;
    const datatables = sourceInfo
      ? syncChartMetadata(p2.datatables, uniqueId, clonedDifficultyMetadataPatch(sourceInfo, 'oni', 'ura'))
      : p2.datatables;
    set({
      project: {
        kind: 'open',
        project: {
          ...p2,
          datatables,
          songs: songIndexAfterDatatableChange(p2.songs, p2.datatables, datatables),
          fumenCreated,
          fumenRemoved,
          undo,
          redo: [],
        },
      },
      save: { kind: 'idle' },
    });
    if (get().selection.songId === songId) {
      const merged = mergeSongSlots(get().songDiskSlots ?? [], songId, fumenCreated, fumenRemoved);
      set({ songSlots: merged });
      const firstUra = merged.find((s) => s.difficulty === 'ura');
      if (firstUra) await get().selectFumen('ura', firstUra.player);
    }
  };

  /**
   * Delete a song's Ura: drop any unsaved created Ura, schedule existing `_x`
   * files for removal, and leave Ura metadata enablement unchanged.
   */
  const deleteUra = (uniqueId: number): void => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    const songId = p.songs.byUniqueId.get(uniqueId)?.id;
    if (!songId) return;
    const slots = get().songSlots ?? [];
    const uraSlots = slots.filter((s) => s.difficulty === 'ura');

    const fumenCreated = new Map(p.fumenCreated);
    const fumenRemoved = new Map(p.fumenRemoved);
    const fumenDrafts = new Map(p.fumenDrafts);
    const createdUraKeys = new Set<string>();
    for (const [key, c] of p.fumenCreated) {
      if (c.songId === songId && c.slot.difficulty === 'ura') createdUraKeys.add(key);
    }
    for (const key of createdUraKeys) {
      fumenCreated.delete(key);
      fumenDrafts.delete(key);
    }
    for (const slot of uraSlots) {
      const key = fumenKey(songId, slot.filename);
      if (createdUraKeys.has(key)) continue; // a creation we just dropped — no disk file
      fumenRemoved.set(key, { songId, filename: slot.filename });
      fumenDrafts.delete(key);
    }

    const unchanged =
      fumenCreated.size === p.fumenCreated.size
      && fumenRemoved.size === p.fumenRemoved.size
      && fumenDrafts.size === p.fumenDrafts.size;
    if (unchanged) return;

    set({
      project: {
        kind: 'open',
        project: { ...p, fumenCreated, fumenRemoved, fumenDrafts, undo: pushHistory(p), redo: [] },
      },
      save: { kind: 'idle' },
    });
    if (get().selection.songId === songId) {
      const merged = mergeSongSlots(get().songDiskSlots ?? [], songId, fumenCreated, fumenRemoved);
      set({ songSlots: merged });
      if (get().selection.difficulty === 'ura') {
        const oni = merged.find((slot) => slot.difficulty === 'oni' && slot.player === get().selection.player)
          ?? merged.find((slot) => slot.difficulty === 'oni');
        if (oni) void get().selectFumen('oni', oni.player);
        else set({ fumen: { kind: 'idle' } });
      }
    }
  };

  /**
   * Create a blank chart for a difficulty the song doesn't yet have — the entry
   * point for authoring a chart from scratch. Writes the full single/p1/p2 blank
   * triple (like the Ura path, but built rather than cloned) into `fumenCreated`,
   * zeroes that difficulty's derived musicinfo, and selects the new chart. Star
   * enablement is left to the Metadata tab (as with Ura), so a created chart can
   * be authored before it is made playable in-game.
   */
  const addBlankDifficulty = async (uniqueId: number, difficulty: FumenDifficulty): Promise<void> => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    const songId = p.songs.byUniqueId.get(uniqueId)?.id;
    if (!songId) return;

    // Re-enabling a difficulty whose deletion is still pending (off→on before a
    // save): cancel the removals so the original files are kept, don't re-blank.
    const pendingRemovals = [...p.fumenRemoved].filter(
      ([, r]) => r.songId === songId && parseFumenFilename(songId, r.filename)?.difficulty === difficulty,
    );
    if (pendingRemovals.length > 0) {
      const fumenRemoved = new Map(p.fumenRemoved);
      for (const [key] of pendingRemovals) fumenRemoved.delete(key);
      set({
        project: { kind: 'open', project: { ...p, fumenRemoved, undo: pushHistory(p), redo: [] } },
        save: { kind: 'idle' },
      });
      if (get().selection.songId === songId) {
        const merged = mergeSongSlots(get().songDiskSlots ?? [], songId, p.fumenCreated, fumenRemoved);
        set({ songSlots: merged });
        const first = merged.find((s) => s.difficulty === difficulty);
        if (first) await get().selectFumen(difficulty, first.player);
      }
      return;
    }

    const slots = get().songSlots ?? [];
    if (slots.some((s) => s.difficulty === difficulty)) return; // already present

    const created = blankFumenSlotSet(songId, difficulty, { star: songStarFor(p, uniqueId, difficulty) });
    const fumenCreated = new Map(p.fumenCreated);
    const fumenRemoved = new Map(p.fumenRemoved);
    for (const c of created) {
      const key = fumenKey(c.songId, c.slot.filename);
      fumenCreated.set(key, c);
      fumenRemoved.delete(key);
    }

    // A blank chart has no notes, rolls, or balloons — zero this difficulty's
    // derived musicinfo so it doesn't inherit a stale row's counts.
    const fields = CHART_METADATA_FIELDS[difficulty];
    const datatables = syncChartMetadata(p.datatables, uniqueId, {
      [fields.branch]: false,
      [fields.notes]: 0,
      [fields.renda]: 0,
      [fields.fuusen]: 0,
    } as MusicInfoChartDerivedPatch);

    set({
      project: {
        kind: 'open',
        project: {
          ...p,
          datatables,
          songs: songIndexAfterDatatableChange(p.songs, p.datatables, datatables),
          fumenCreated,
          fumenRemoved,
          undo: pushHistory(p),
          redo: [],
        },
      },
      save: { kind: 'idle' },
    });
    if (get().selection.songId === songId) {
      const merged = mergeSongSlots(get().songDiskSlots ?? [], songId, fumenCreated, fumenRemoved);
      set({ songSlots: merged });
      const first = merged.find((s) => s.difficulty === difficulty);
      if (first) await get().selectFumen(difficulty, first.player);
    }
  };

  // ── Dani Dojo helpers (self-contained; not the project undo/redo) ──────────
  /**
   * Apply a pure transform to one dani file slot's draft, pushing the pre-edit
   * draft onto that slot's own undo stack. `selUpdate` replaces the selection
   * (pass `null` to clear it, omit to leave it). A no-op transform with no
   * selection change is ignored.
   */
  const daniMutateSlot = (
    section: DanSection,
    produce: (draft: DanConfig) => DanConfig,
    selUpdate?: DaniSelection | null,
  ): void => {
    const st = get().dani;
    const slot = st[section];
    const before = slot.draft;
    const next = produce(before);
    const changed = next !== before;
    if (!changed && selUpdate === undefined) return;
    const newSlot = changed
      ? { ...slot, draft: next, undo: cappedPush(slot.undo, before), redo: [] }
      : slot;
    const sel = selUpdate === undefined ? st.sel : (selUpdate ?? undefined);
    set({ dani: { ...st, [section]: newSlot, sel, error: undefined } });
  };

  /** A single-dan content edit, followed by the verupNo auto-bump for that dan. */
  const daniEditDan = (section: DanSection, danId: number, transform: (c: DanConfig) => DanConfig): void => {
    daniMutateSlot(section, (draft) => {
      const edited = transform(draft);
      if (edited === draft) return draft;
      return autoBumpVerup(edited, get().dani[section].baseline, danId);
    });
  };

  // Reflect the persisted theme onto the document at startup so the store state
  // and [data-theme] agree (index.html also applies it pre-paint to avoid a flash).
  const initialTheme = loadStoredTheme();
  applyThemeToDocument(initialTheme);
  const initialUiLang = loadStoredUiLang();
  applyDocumentLang(initialUiLang);
  const initialKeys = loadStoredKeys();

  return {
  support: detectBrowserSupport(),
  project: { kind: 'idle' },
  selection: { difficulty: 'oni', player: 'single' },
  chart: { tool: 'select', branchFocus: 'all' },
  ui: {
    locale: songLocaleForUiLang(initialUiLang),
    uiLang: initialUiLang,
    theme: initialTheme,
    search: '',
    area: 'songs',
    tab: 'chart',
    zoom: 1,
    noteScale: 1,
    filters: [],
    songSort: 'uniqueId',
    saveDialogOpen: false,
    saveScope: undefined,
    exportDialogOpen: false,
    settingsOpen: false,
    aboutOpen: !loadWelcomeSeen(),
    g719DecoderRevision: 0,
    addSongOpen: false,
    tjaImportOpen: false,
  },
  fumen: { kind: 'idle' },
  save: { kind: 'idle' },
  dani: {
    normal: emptyDaniSlot('dan_data.json'),
    gaiden: emptyDaniSlot('gaiden_data.json'),
    saving: false,
  },
  setup: {
    remembered: false,
    datatableKey: initialKeys.datatable,
    fumenKey: initialKeys.fumen,
    busy: false,
  },

  initFromStoredHandle: async () => {
    if (!get().support.ok) return;
    const stored = await loadProjectRootHandle();
    if (!stored) return;
    const perm = await queryRead(stored);
    if (perm !== 'granted') {
      set({ project: { kind: 'needs-permission', handle: stored } });
      return;
    }
    // Folder is remembered and readable. If we also remember the keys, open
    // silently; otherwise seed the setup form with the folder so the user just
    // pastes keys and clicks Open.
    const keys = loadStoredKeys();
    const seedSetup = (error?: OpenValidationError) =>
      set({
        project: { kind: 'idle' },
        setup: {
          ...get().setup,
          handle: stored,
          folderName: stored.name,
          remembered: true,
          datatableKey: keys.datatable || get().setup.datatableKey,
          fumenKey: keys.fumen || get().setup.fumenKey,
          error,
        },
      });
    if (!hasStoredKeys(keys)) {
      seedSetup();
      return;
    }
    set({ project: { kind: 'opening' } });
    const res = await openRememberedProject(stored, keys);
    if (res.ok) {
      set({
        project: { kind: 'open', project: res.project },
        setup: {
          ...get().setup,
          handle: stored,
          folderName: stored.name,
          remembered: true,
          datatableKey: keys.datatable,
          fumenKey: keys.fumen,
          error: undefined,
        },
      });
    }
    else seedSetup(res.error);
  },

  setupPickFolder: async () => {
    const res = await pickProjectFolder();
    if (!res.ok) {
      if (res.cancelled) return; // user dismissed the OS dialog — leave the form as-is
      set({ setup: { ...get().setup, error: { field: 'generic', message: res.message ?? 'Could not open the folder picker.' } } });
      return;
    }
    set({
      setup: { ...get().setup, handle: res.handle, folderName: res.handle.name, remembered: false, error: undefined },
    });
  },

  setupSetKey: (which, value) => {
    const s = get().setup;
    const patch = which === 'datatable' ? { datatableKey: value } : { fumenKey: value };
    set({ setup: { ...s, ...patch, error: undefined } });
  },

  setupOpenProject: async () => {
    const s = get().setup;
    if (!s.handle || s.busy) return;
    set({ setup: { ...s, busy: true, error: undefined } });
    const keys: ProjectKeys = { datatable: s.datatableKey.trim(), fumen: s.fumenKey.trim() };
    const res = await openProjectWithKeys(s.handle, keys);
    if (!res.ok) {
      set({ setup: { ...get().setup, busy: false, error: res.error } });
      return;
    }
    try {
      const project = await openProjectFromRoot(res.root);
      await saveProjectRootHandle(res.root.handle);
      if (res.root.keys) persistKeys(res.root.keys);
      // Settings stays open on purpose: opening and closing a project are both
      // done from there, so the dialog is the user's place to stand.
      set({
        project: { kind: 'open', project },
        setup: { ...get().setup, busy: false, remembered: true, error: undefined },
      });
    } catch (e) {
      set({ setup: { ...get().setup, busy: false, error: { field: 'generic', message: (e as Error).message } } });
    }
  },

  reconnect: async () => {
    const cur = get().project;
    if (cur.kind !== 'needs-permission') return;
    const perm = await requestReadWrite(cur.handle);
    if (perm !== 'granted') {
      set({ project: { kind: 'error', message: 'Permission was not granted.' } });
      return;
    }
    const keys = loadStoredKeys();
    const seedSetup = (error?: OpenValidationError) =>
      set({
        project: { kind: 'idle' },
        setup: {
          ...get().setup,
          handle: cur.handle,
          folderName: cur.handle.name,
          remembered: true,
          datatableKey: keys.datatable || get().setup.datatableKey,
          fumenKey: keys.fumen || get().setup.fumenKey,
          error,
        },
      });
    if (!hasStoredKeys(keys)) {
      seedSetup();
      return;
    }
    set({ project: { kind: 'opening' } });
    const res = await openRememberedProject(cur.handle, keys);
    if (res.ok) {
      set({
        project: { kind: 'open', project: res.project },
        setup: {
          ...get().setup,
          handle: cur.handle,
          folderName: cur.handle.name,
          remembered: true,
          datatableKey: keys.datatable,
          fumenKey: keys.fumen,
          error: undefined,
        },
        ui: { ...get().ui, settingsOpen: false },
      });
    }
    else seedSetup(res.error);
  },

  forgetProject: async () => {
    await clearProjectRootHandle();
    set({
      project: { kind: 'idle' },
      selection: { difficulty: 'oni', player: 'single' },
      chart: { tool: 'select', branchFocus: 'all' },
      songSlots: undefined,
      songDiskSlots: undefined,
      fumen: { kind: 'idle' },
      save: { kind: 'idle' },
      // Reset the setup form back to step 1 (keys stay prefilled from storage).
      setup: { ...get().setup, handle: undefined, folderName: undefined, remembered: false, busy: false, error: undefined },
      ui: {
        ...get().ui,
        saveDialogOpen: false,
        exportDialogOpen: false,
        addSongOpen: false,
        deleteSongId: undefined,
        tjaImportOpen: false,
      },
    });
  },

  openSettings: () => set({ ui: { ...get().ui, settingsOpen: true } }),
  closeSettings: () => set({ ui: { ...get().ui, settingsOpen: false } }),
  openAbout: () => set({ ui: { ...get().ui, aboutOpen: true } }),
  closeAbout: () => {
    persistWelcomeSeen();
    set({ ui: { ...get().ui, aboutOpen: false } });
  },
  notifyG719DecoderChanged: () =>
    set({ ui: { ...get().ui, g719DecoderRevision: get().ui.g719DecoderRevision + 1 } }),

  setSearch: (q) => set({ ui: { ...get().ui, search: q } }),
  setUiLang: (l) => {
    persistUiLang(l);
    applyDocumentLang(l);
    // The song-title display locale follows the UI language (one language control).
    set({ ui: { ...get().ui, uiLang: l, locale: songLocaleForUiLang(l) } });
  },
  setTheme: (t) => {
    persistTheme(t);
    applyThemeToDocument(t);
    set({ ui: { ...get().ui, theme: t } });
  },
  toggleTheme: () => get().setTheme(get().ui.theme === 'dark' ? 'light' : 'dark'),
  setArea: (a) => set({ ui: { ...get().ui, area: a } }),
  setTab: (t) => set({ ui: { ...get().ui, tab: t } }),
  setZoom: (zoom) => set({ ui: { ...get().ui, zoom } }),
  setNoteScale: (noteScale) =>
    set({ ui: { ...get().ui, noteScale: Math.max(0.5, Math.min(2, noteScale)) } }),
  toggleSongFilter: (filter) => set({
    ui: { ...get().ui, filters: toggleSongFilter(get().ui.filters, filter) },
  }),
  setSongSort: (songSort) => set({ ui: { ...get().ui, songSort } }),

  selectSong: async (id) => {
    const project = get().project;
    if (project.kind !== 'open') return;
    set({
      selection: { ...get().selection, songId: id },
      chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined, branchFocus: 'all' },
      songSlots: undefined,
      songDiskSlots: undefined,
      fumen: { kind: 'idle' },
    });
    let disk: FumenSlot[];
    try {
      disk = await listSongFumenSlots(project.project.root, id);
    } catch {
      disk = [];
    }
    if (get().selection.songId !== id) return; // user moved on
    // Merge disk slots with any pending create/delete for this song.
    const live = get().project;
    const created = live.kind === 'open' ? live.project.fumenCreated : new Map<string, CreatedFumen>();
    const removed = live.kind === 'open' ? live.project.fumenRemoved : new Map<string, RemovedFumenSlot>();
    const slots = mergeSongSlots(disk, id, created, removed);
    set({ songDiskSlots: disk, songSlots: slots });
    // Pick best initial slot: prefer current difficulty+player, else first. Ura
    // is selectable regardless of metadata enablement (chart editing is decoupled
    // from `starUra`).
    if (slots.length === 0) {
      set({ fumen: { kind: 'idle' } });
      return;
    }
    const cur = get().selection;
    const exact = slots.find((s) => s.difficulty === cur.difficulty && s.player === cur.player);
    const sameDiff = slots.find((s) => s.difficulty === cur.difficulty);
    const fallback = exact ?? sameDiff ?? slots[0];
    await get().selectFumen(fallback.difficulty, fallback.player);
  },

  selectFumen: async (difficulty, player) => {
    const state = get();
    const project = state.project;
    if (project.kind !== 'open') return;
    const songId = state.selection.songId;
    if (!songId) return;
    const slots = state.songSlots ?? [];
    const slot = slots.find((s) => s.difficulty === difficulty && s.player === player);
    set({
      selection: { ...state.selection, difficulty, player },
      chart: { ...state.chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined, branchFocus: 'all' },
    });
    if (!slot) {
      set({ fumen: { kind: 'idle' } });
      return;
    }
    // Show an in-memory chart without touching disk: an edited draft (chart
    // edits must survive a slot switch) or a pending-created chart (no disk file
    // exists yet, so a disk read would fail).
    const key = fumenKey(songId, slot.filename);
    const draft = project.project.fumenDrafts.get(key);
    const created = project.project.fumenCreated.get(key);
    const baseline = project.project.fumenBaselines.get(key);
    if (draft) {
      set({ fumen: { kind: 'ready', loaded: { ...slot, songId, bytes: baseline?.bytes ?? new Uint8Array(0), fumen: draft } } });
      return;
    }
    if (created) {
      set({ fumen: { kind: 'ready', loaded: { ...created.slot, songId, bytes: new Uint8Array(0), fumen: created.fumen } } });
      return;
    }
    set({ fumen: { kind: 'loading', songId, slot } });
    try {
      const loaded = await loadFumen(project.project.root, songId, slot);
      const cur = get();
      if (cur.selection.songId !== songId || cur.selection.difficulty !== difficulty || cur.selection.player !== player) {
        return; // user moved on
      }
      // Record the disk-decoded chart as this slot's diff floor (once).
      if (cur.project.kind === 'open' && !cur.project.project.fumenBaselines.has(key)) {
        const cp = cur.project.project;
        const fumenBaselines = new Map(cp.fumenBaselines);
        fumenBaselines.set(key, { songId, slot, fumen: loaded.fumen, bytes: loaded.bytes });
        set({ project: { kind: 'open', project: { ...cp, fumenBaselines } } });
      }
      // A draft may have been created for this slot before the disk read resolved.
      const after = get().project;
      const live = after.kind === 'open' ? after.project.fumenDrafts.get(key) : undefined;
      set({ fumen: { kind: 'ready', loaded: { ...loaded, fumen: live ?? loaded.fumen } } });
    } catch (e) {
      set({ fumen: { kind: 'error', songId, slot, message: (e as Error).message } });
    }
  },

  // ── Editing ──────────────────────────────────────────────
  editMusicInfo: (uniqueId, patch) => applyEdit((d) => editMusicInfoFields(d, uniqueId, patch)),
  editStar: (uniqueId, field, value) => applyEdit((d) => setStar(d, uniqueId, field, value)),
  // Enablement only flips the `starUra` metadata flag. The Ura chart stays
  // selectable/editable whether or not it's enabled, so disabling never ejects
  // the user from a chart they're editing (DiffTabs shows a not-enabled warning).
  setUraEnabled: (uniqueId, on) => applyEdit((d) => editUraEnabled(d, uniqueId, on)),
  setDifficultyBranch: async (uniqueId, difficulty, on) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p0 = cur.project;
    const songId = p0.songs.byUniqueId.get(uniqueId)?.id;
    if (!songId) return;

    // Slots for this difficulty. The Metadata tab always edits the selected song,
    // so its merged songSlots list is authoritative; fall back to a disk listing
    // for the (unexpected) off-selection case.
    let allSlots: FumenSlot[];
    if (get().selection.songId === songId && get().songSlots) {
      allSlots = get().songSlots ?? [];
    } else {
      try { allSlots = await listSongFumenSlots(p0.root, songId); } catch { allSlots = []; }
    }
    const slots = allSlots.filter((s) => s.difficulty === difficulty);

    // No chart file for this difficulty: nothing to branch, so just record the
    // musicinfo flag directly (the toggle stays functional, like Ura enablement).
    if (slots.length === 0) {
      const field = CHART_METADATA_FIELDS[difficulty].branch;
      applyEdit((d) => syncChartMetadata(d, uniqueId, { [field]: on } as MusicInfoChartDerivedPatch));
      return;
    }

    // Load any slot we don't already hold in memory so its header can be patched.
    const toLoad = slots.filter((slot) => {
      const key = fumenKey(songId, slot.filename);
      return !p0.fumenDrafts.has(key) && !p0.fumenCreated.has(key) && !p0.fumenBaselines.has(key);
    });
    const loaded: { key: string; slot: FumenSlot; fumen: Fumen; bytes: Uint8Array }[] = [];
    for (const slot of toLoad) {
      try {
        const l = await loadFumen(p0.root, songId, slot);
        loaded.push({ key: fumenKey(songId, slot.filename), slot, fumen: l.fumen, bytes: l.bytes });
      } catch {
        // Unreadable slot — leave it out; the rest still sync.
      }
    }

    // Re-read state after the awaits (other edits may have raced in).
    const cur2 = get().project;
    if (cur2.kind !== 'open' || get().selection.songId !== songId) return;
    const p = cur2.project;
    const item = p.songs.byUniqueId.get(uniqueId)?.info;
    if (!item) return;
    const fumenBaselines = new Map(p.fumenBaselines);
    for (const { key, slot, fumen, bytes } of loaded) {
      if (!fumenBaselines.has(key)) fumenBaselines.set(key, { songId, slot, fumen, bytes });
    }

    // Flip hasBranches on every player slot of this difficulty. One representative
    // slot (the selected player, else the first) drives the derived musicinfo,
    // exactly as the Inspector toggle would for that single chart — avoids
    // double-counting when both single- and 2P charts exist.
    const rep = slots.find((s) => s.player === get().selection.player) ?? slots[0];
    const fumenDrafts = new Map(p.fumenDrafts);
    const fumenCreated = new Map(p.fumenCreated);
    let metadataPatch: MusicInfoChartDerivedPatch | undefined;
    let changed = false;
    for (const slot of slots) {
      const key = fumenKey(songId, slot.filename);
      const created = fumenCreated.get(key);
      const src = created?.fumen ?? fumenDrafts.get(key) ?? fumenBaselines.get(key)?.fumen;
      if (!src) continue; // couldn't be loaded
      const next = updateFumenHeader(src, { hasBranches: on ? 1 : 0 }).fumen;
      if (slot === rep) metadataPatch = chartMetadataPatchAfterEdit(item, difficulty, src, next);
      if (next === src) continue; // already at this branch state
      changed = true;
      if (created) fumenCreated.set(key, { ...created, fumen: next });
      else fumenDrafts.set(key, next);
    }

    let datatables = p.datatables;
    if (metadataPatch && Object.keys(metadataPatch).length > 0) {
      datatables = syncChartMetadata(datatables, uniqueId, metadataPatch);
    }

    if (!changed && datatables === p.datatables) {
      // Every slot already sits at this branch state. Keep any freshly-read
      // baselines (no history — it isn't an edit) so they aren't reloaded.
      if (loaded.length > 0) set({ project: { kind: 'open', project: { ...p, fumenBaselines } } });
      return;
    }

    set({
      project: {
        kind: 'open',
        project: {
          ...p,
          datatables,
          songs: songIndexAfterDatatableChange(p.songs, p.datatables, datatables),
          fumenBaselines,
          fumenDrafts,
          fumenCreated,
          undo: pushHistory(p),
          redo: [],
        },
      },
      save: { kind: 'idle' },
    });

    // Reflect the change on the currently displayed chart if it was one edited.
    const curF = get().fumen;
    if (curF.kind === 'ready' && curF.loaded.songId === songId) {
      const key = fumenKey(curF.loaded.songId, curF.loaded.filename);
      const nf = fumenCreated.get(key)?.fumen ?? fumenDrafts.get(key);
      if (nf && nf !== curF.loaded.fumen) {
        set({ fumen: { kind: 'ready', loaded: { ...curF.loaded, fumen: nf } } });
      }
    }
  },
  createUraChart: createUra,
  deleteUraChart: deleteUra,
  addBlankDifficulty,
  rememberSoundBankMetadata: (input) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const key = soundMetadataKey(input.filename);
    const existing = cur.project.soundMetadataBaselines.get(key);
    if (
      existing
      && existing.songId === input.songId
      && existing.filename === input.filename
      && existing.displayPath === input.displayPath
      && existing.preferredStem === input.preferredStem
      && existing.demoStartMs === input.demoStartMs
    ) return;
    const soundMetadataBaselines = new Map(cur.project.soundMetadataBaselines);
    soundMetadataBaselines.set(key, { ...input, key });
    const soundMetadataDrafts = new Map(cur.project.soundMetadataDrafts);
    if (soundMetadataDrafts.get(key)?.demoStartMs === input.demoStartMs) {
      soundMetadataDrafts.delete(key);
    }
    set({ project: { kind: 'open', project: { ...cur.project, soundMetadataBaselines, soundMetadataDrafts } } });
  },
  editSoundBankDemoStart: (input) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    const key = soundMetadataKey(input.filename);
    const baseline = p.soundMetadataBaselines.get(key) ?? { ...input, key };
    const demoStartMs = Math.max(0, Math.round(input.demoStartMs));
    const currentDemoStartMs = p.soundMetadataDrafts.get(key)?.demoStartMs ?? baseline.demoStartMs;
    if (p.soundMetadataBaselines.has(key) && demoStartMs === currentDemoStartMs) return;
    const soundMetadataBaselines = p.soundMetadataBaselines.has(key)
      ? p.soundMetadataBaselines
      : new Map(p.soundMetadataBaselines).set(key, baseline);
    const soundMetadataDrafts = new Map(p.soundMetadataDrafts);
    if (demoStartMs === baseline.demoStartMs) {
      soundMetadataDrafts.delete(key);
    } else {
      soundMetadataDrafts.set(key, { ...input, key, demoStartMs });
    }
    const sameDraft =
      soundMetadataDrafts.size === p.soundMetadataDrafts.size
      && [...soundMetadataDrafts].every(([draftKey, draft]) => p.soundMetadataDrafts.get(draftKey) === draft);
    if (soundMetadataBaselines === p.soundMetadataBaselines && sameDraft) return;
    set({
      project: {
        kind: 'open',
        project: { ...p, soundMetadataBaselines, soundMetadataDrafts, undo: pushHistory(p), redo: [] },
      },
      save: { kind: 'idle' },
    });
  },
  editTitle: (songId, locale, value) =>
    applyEdit((d) => setTitle(d, songId, locale, value)),
  editSubtitle: (songId, locale, value) =>
    applyEdit((d) => setSubtitle(d, songId, locale, value)),
  reorderSong: (songId, fromGenreNo, fromIndex, toGenreNo, toIndex) =>
    applyEdit((d) => reorderMusicOrder(d, songId, fromGenreNo, fromIndex, toGenreNo, toIndex)),
  sortOrderGenre: (genreNo, locale) =>
    applyEdit((d) => sortMusicOrderGenre(d, genreNo, locale)),
  addSongToOrder: (genreNo, uniqueId) =>
    applyEdit((d) => insertMusicOrderEntry(d, uniqueId, genreNo)),
  removeSongFromOrder: (songId, genreNo, index) =>
    applyEdit((d) => removeMusicOrderEntry(d, songId, genreNo, index)),
  revealSongInEditor: (songId) => {
    set({ ui: { ...get().ui, area: 'songs' } });
    void get().selectSong(songId);
  },

  addSong: (song) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    applyEdit((d) => editsAddSong(d, song));
    // If it landed, jump to it on the Metadata tab so the user can fill it in.
    const after = get().project;
    if (after.kind !== 'open') return;
    const row = after.project.songs.byId.get(song.id.trim());
    set({ ui: { ...get().ui, addSongOpen: false, area: 'songs', tab: 'metadata' } });
    if (row) get().selectSong(row.id);
  },

  deleteSong: (uniqueId) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    const songId = p.songs.byUniqueId.get(uniqueId)?.id;
    const datatables = editsDeleteSong(p.datatables, uniqueId);
    if (datatables === p.datatables) {
      set({ ui: { ...get().ui, deleteSongId: undefined } });
      return;
    }
    // Drop any pending chart create/delete/edit for the removed song so the save
    // reconciliation (which backs up + removes the song's fumen folder) isn't
    // undone by a later create-write resurrecting it.
    // songId is always set for a deletable song; the falsy branch keeps every
    // key (a never-matching filter) rather than purging all of them.
    const keep = songId
      ? (k: string) => !k.startsWith(`${songId}/`)
      : () => true;
    const fumenCreated = new Map([...p.fumenCreated].filter(([k]) => keep(k)));
    const fumenRemoved = new Map([...p.fumenRemoved].filter(([k]) => keep(k)));
    const fumenDrafts = new Map([...p.fumenDrafts].filter(([k]) => keep(k)));
    const soundMetadataDrafts = new Map(
      [...p.soundMetadataDrafts].filter(([, draft]) => draft.songId !== songId),
    );
    set({
      project: {
        kind: 'open',
        project: {
          ...p,
          datatables,
          songs: songIndexAfterDatatableChange(p.songs, p.datatables, datatables),
          fumenCreated,
          fumenRemoved,
          fumenDrafts,
          soundMetadataDrafts,
          undo: pushHistory(p),
          redo: [],
        },
      },
      save: { kind: 'idle' },
    });
    // Drop the selection if we just deleted the open song.
    if (songId === get().selection.songId) {
      set({
        selection: { ...get().selection, songId: undefined },
        chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined },
        songSlots: undefined,
        songDiskSlots: undefined,
        fumen: { kind: 'idle' },
      });
    }
    set({ ui: { ...get().ui, deleteSongId: undefined } });
  },

  replaceSongAudio: async (uniqueId, file) => {
    const cur = get().project;
    if (cur.kind !== 'open') throw new Error('Open a project before replacing audio.');
    const row = cur.project.songs.byUniqueId.get(uniqueId);
    if (!row) throw new Error(`Song No. ${uniqueId} is no longer in the project.`);
    const result = await replaceSoundFile(cur.project.root, row.info, file);
    const latest = get().project;
    if (latest.kind === 'open') {
      const soundFiles = new Set(latest.project.assets.soundFiles);
      soundFiles.add(result.filename);
      set({
        project: {
          kind: 'open',
          project: { ...latest.project, assets: { ...latest.project.assets, soundFiles } },
        },
      });
    }
    return result;
  },

  removeSongAudio: async (uniqueId) => {
    const cur = get().project;
    if (cur.kind !== 'open') throw new Error('Open a project before removing audio.');
    const row = cur.project.songs.byUniqueId.get(uniqueId);
    if (!row) throw new Error(`Song No. ${uniqueId} is no longer in the project.`);
    const result = await removeSoundFile(cur.project.root, row.info);
    const latest = get().project;
    if (latest.kind === 'open') {
      const soundFiles = new Set(latest.project.assets.soundFiles);
      soundFiles.delete(result.filename);
      set({
        project: {
          kind: 'open',
          project: { ...latest.project, assets: { ...latest.project.assets, soundFiles } },
        },
      });
    }
    return result;
  },

  setChartTool: (tool) => set({ chart: { ...get().chart, tool } }),
  setBranchFocus: (focus) =>
    set({ chart: { ...get().chart, branchFocus: focus, selectedNote: undefined, selectedNotes: undefined } }),
  selectChartNote: (ref) =>
    set({ chart: { ...get().chart, selectedNote: ref, selectedNotes: undefined, selectedMeasure: undefined } }),
  selectChartNotes: (refs) => {
    // A 1-note marquee collapses to a normal single selection so the inspector
    // can edit it; 0 clears; >1 becomes the multi-selection.
    if (refs.length === 0) {
      set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined } });
    } else if (refs.length === 1) {
      set({ chart: { ...get().chart, selectedNote: refs[0], selectedNotes: undefined, selectedMeasure: undefined } });
    } else {
      set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: refs, selectedMeasure: undefined } });
    }
  },
  selectChartMeasure: (ref) =>
    set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: ref } }),
  navigateChartSelection: (key) => {
    const state = get();
    if (state.fumen.kind !== 'ready' || state.chart.selectedNotes) return;
    const fumen = state.fumen.loaded.fumen;
    const { selectedNote, selectedMeasure, branchFocus } = state.chart;

    if (key === 'toggle') {
      if (selectedNote) {
        state.selectChartMeasure({
          measureIndex: selectedNote.measureIndex,
          branchIndex: branchFocus === 'all' ? undefined : branchFocus,
        });
      } else if (selectedMeasure) {
        const branchIndex =
          selectedMeasure.branchIndex ?? (branchFocus === 'all' ? undefined : branchFocus);
        const first = firstNoteInMeasure(fumen, selectedMeasure.measureIndex, branchIndex);
        if (first) state.selectChartNote(first);
      }
      return;
    }

    const direction = key === 'left' ? -1 : 1;
    if (selectedNote) {
      const next = adjacentNote(fumen, selectedNote, direction);
      if (next) state.selectChartNote(next);
      return;
    }
    if (selectedMeasure) {
      const measureIndex = selectedMeasure.measureIndex + direction;
      if (measureIndex >= 0 && measureIndex < fumen.measures.length) {
        state.selectChartMeasure({ ...selectedMeasure, measureIndex });
      }
    }
  },
  placeChartNote: (input) => {
    const result = applyFumenEdit((f) => insertChartNote(f, input)) as
      | { fumen: Fumen; selection?: ChartNoteRef } | undefined;
    if (result) set({ chart: { ...get().chart, selectedNote: result.selection, selectedNotes: undefined, selectedMeasure: undefined } });
  },
  eraseChartNote: (ref) => {
    const result = applyFumenEdit((f) => removeChartNote(f, ref));
    if (result) set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined } });
  },
  eraseSelectedChartNotes: () => {
    const { selectedNote, selectedNotes } = get().chart;
    const refs = selectedNotes ?? (selectedNote ? [selectedNote] : []);
    if (refs.length === 0) return;
    const result = applyFumenEdit((f) => removeChartNotes(f, refs));
    if (result) set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined } });
  },
  updateSelectedChartNote: (patch) => {
    const selected = get().chart.selectedNote;
    if (!selected) return;
    const result = applyFumenEdit((f) => updateChartNote(f, selected, patch)) as
      | { fumen: Fumen; selection?: ChartNoteRef } | undefined;
    if (result) set({ chart: { ...get().chart, selectedNote: result.selection, selectedNotes: undefined, selectedMeasure: undefined } });
  },
  setMeasureBpm: (measureIndex, on, value) => {
    applyFumenEdit((f) => setMeasureBpmOverride(f, measureIndex, on, value));
  },
  setMeasureSpeed: (measureIndex, target, on, value) => {
    applyFumenEdit((f) => setBranchSpeedOverride(f, measureIndex, target, on, value));
  },
  setMeasureGogo: (measureIndex, on) => {
    applyFumenEdit((f) => editMeasureGogo(f, measureIndex, on));
  },
  setMeasureBarline: (measureIndex, on) => {
    applyFumenEdit((f) => editMeasureBarline(f, measureIndex, on));
  },
  setMeasureBranchInfo: (measureIndex, branchInfo) => {
    applyFumenEdit((f) => editMeasureBranchInfo(f, measureIndex, branchInfo));
  },
  setMeasureDuration: (measureIndex, newDurationMs, policy) => {
    applyFumenEdit((f) => editMeasureDuration(f, measureIndex, newDurationMs, policy));
  },
  editCurrentFumenOffset: async (offsetMs) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const songId = get().selection.songId;
    const slots = get().songSlots ?? [];
    if (!songId || slots.length === 0) {
      // No slot list (shouldn't happen with a chart open) — fall back to editing
      // just the loaded chart so the control still works.
      applyFumenEdit((f) => setChartAudioOffset(f, offsetMs));
      return;
    }

    // Load any slot we don't already hold in memory so every file can be edited.
    const p0 = cur.project;
    const toLoad = slots.filter((slot) => {
      const key = fumenKey(songId, slot.filename);
      return !p0.fumenDrafts.has(key) && !p0.fumenCreated.has(key) && !p0.fumenBaselines.has(key);
    });
    const loaded: { key: string; slot: FumenSlot; fumen: Fumen; bytes: Uint8Array }[] = [];
    for (const slot of toLoad) {
      try {
        const l = await loadFumen(p0.root, songId, slot);
        loaded.push({ key: fumenKey(songId, slot.filename), slot, fumen: l.fumen, bytes: l.bytes });
      } catch {
        // Unreadable slot — leave it out; the rest still sync.
      }
    }

    // Re-read state after the awaits (other edits may have raced in).
    const cur2 = get().project;
    if (cur2.kind !== 'open' || get().selection.songId !== songId) return;
    const p = cur2.project;
    const fumenBaselines = new Map(p.fumenBaselines);
    for (const { key, slot, fumen, bytes } of loaded) {
      if (!fumenBaselines.has(key)) fumenBaselines.set(key, { songId, slot, fumen, bytes });
    }

    // Shift the audio offset across every measure of every slot, preserving each
    // slot's other (draft) edits. setChartAudioOffset adds the same delta to all
    // measures so the whole chart moves together (not just measure 0) and keeps
    // sub-ms precision so a revert is byte-clean.
    const fumenDrafts = new Map(p.fumenDrafts);
    const fumenCreated = new Map(p.fumenCreated);
    let changed = false;
    for (const slot of slots) {
      const key = fumenKey(songId, slot.filename);
      const created = fumenCreated.get(key);
      const src = created?.fumen ?? fumenDrafts.get(key) ?? fumenBaselines.get(key)?.fumen;
      if (!src) continue; // couldn't be loaded
      const next = setChartAudioOffset(src, offsetMs).fumen;
      if (next === src) continue; // already at this offset
      changed = true;
      if (created) fumenCreated.set(key, { ...created, fumen: next });
      else fumenDrafts.set(key, next);
    }

    if (!changed) {
      // Every slot already sits at this offset. Still keep any baselines we just
      // read (no history — it isn't an edit) so they aren't reloaded next time.
      if (loaded.length > 0) set({ project: { kind: 'open', project: { ...p, fumenBaselines } } });
      return;
    }

    set({
      project: {
        kind: 'open',
        project: { ...p, fumenBaselines, fumenDrafts, fumenCreated, undo: pushHistory(p), redo: [] },
      },
      save: { kind: 'idle' },
    });

    // Reflect the change on the currently displayed chart.
    const curF = get().fumen;
    if (curF.kind === 'ready') {
      const key = fumenKey(curF.loaded.songId, curF.loaded.filename);
      const nf = fumenCreated.get(key)?.fumen ?? fumenDrafts.get(key);
      if (nf && nf !== curF.loaded.fumen) {
        set({ fumen: { kind: 'ready', loaded: { ...curF.loaded, fumen: nf } } });
      }
    }
  },
  updateChartHeader: (patch) => {
    applyFumenEdit((f) => updateFumenHeader(f, patch));
  },
  seedChartBranches: () => {
    const result = applyFumenEdit((f) => seedBranchesFromNormal(f));
    // New Expert/Master notes shift indices, so drop any stale selection.
    if (result) set({ chart: { ...get().chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined } });
  },
  setChartScoring: (base, step) => {
    // Not routed through applyFumenEdit: that path re-stamps with the chart's
    // *pre-edit* base/step, which would immediately revert this change. Here we
    // stamp the new values directly. Works on any chart (a saved-then-reopened
    // from-scratch chart is indistinguishable from a shipped one).
    const cur = get().fumen;
    if (cur.kind !== 'ready') return;
    const proj = get().project;
    if (proj.kind !== 'open') return;
    const p = proj.project;
    const key = fumenKey(cur.loaded.songId, cur.loaded.filename);
    const before = cur.loaded.fumen;
    const current = readChartScoring(before);
    if (current.base === undefined) return; // no notes carry a base yet
    const b = Math.max(1, Math.min(0xffff, Math.round(base)));
    const s = Math.max(0, Math.min(0xffff, Math.round(step)));
    if (current.base === b && current.step === s) return; // no-op
    // Re-stamp base/step and recompute the ceiling. The gauge is note-count based,
    // so it is unaffected — left as-is, never clobbering a shipped chart's tuning.
    const next = withScoreCeiling(stampChartScoring(before, { base: b, diff: s }));
    const fumenDrafts = new Map(p.fumenDrafts);
    fumenDrafts.set(key, next);
    set({
      project: { kind: 'open', project: { ...p, fumenDrafts, undo: pushHistory(p), redo: [] } },
      fumen: { kind: 'ready', loaded: { ...cur.loaded, fumen: next } },
      save: { kind: 'idle' },
    });
  },

  openAddSong: () => set({ ui: { ...get().ui, addSongOpen: true } }),
  closeAddSong: () => set({ ui: { ...get().ui, addSongOpen: false } }),
  openDeleteSong: (uniqueId) => set({ ui: { ...get().ui, deleteSongId: uniqueId } }),
  closeDeleteSong: () => set({ ui: { ...get().ui, deleteSongId: undefined } }),
  openTjaImport: () => {
    const state = get();
    if (state.project.kind !== 'open' || !state.selection.songId) return;
    set({ ui: { ...state.ui, tjaImportOpen: true } });
  },
  closeTjaImport: () => set({ ui: { ...get().ui, tjaImportOpen: false } }),
  importTja: async (uniqueId, imported, options = DEFAULT_TJA_IMPORT_OPTIONS) => {
    const initial = get();
    if (initial.project.kind !== 'open') return { ok: false, message: 'No project is open.' };
    const initialRow = initial.project.project.songs.byUniqueId.get(uniqueId);
    if (!initialRow || initial.selection.songId !== initialRow.id) {
      return { ok: false, message: 'The selected song changed before the import completed.' };
    }
    const songId = initialRow.id;
    const desired = imported.charts.map((chart) => ({ chart, slot: importChartSlot(songId, chart) }));
    const desiredNames = new Set(desired.map(({ slot }) => slot.filename));

    let diskSlots = initial.songDiskSlots;
    if (options.charts && !diskSlots) {
      try {
        diskSlots = await listSongFumenSlots(initial.project.project.root, songId);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }

    // Replacing an existing file needs its original decoded bytes as the save
    // diff floor. Load only desired disk slots that have not previously been
    // opened; files being removed do not need to be decoded.
    const loaded: { key: string; slot: FumenSlot; fumen: Fumen; bytes: Uint8Array }[] = [];
    for (const slot of options.charts ? diskSlots ?? [] : []) {
      if (!desiredNames.has(slot.filename)) continue;
      const key = fumenKey(songId, slot.filename);
      if (initial.project.project.fumenBaselines.has(key)) continue;
      try {
        const value = await loadFumen(initial.project.project.root, songId, slot);
        loaded.push({ key, slot, fumen: value.fumen, bytes: value.bytes });
      } catch (error) {
        return {
          ok: false,
          message: `Could not read fumen/${songId}/${slot.filename}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // The demo start lives in the bank, not the chart: read the file's current
    // value up front so the edit has a baseline to diff against, exactly as the
    // Sound tab does. Without one the import would register a draft equal to its
    // own baseline and quietly write nothing on save.
    let demoStart: { key: string; filename: string; displayPath: string; stem: string; currentMs: number } | undefined;
    if (options.demoStart && imported.demoStartMs !== undefined) {
      const resolved = resolveSoundFile(initialRow.info);
      const stem = resolved.filename.replace(/\.nus3bank$/i, '');
      try {
        const bytes = await readSoundBankBytes(initial.project.project.root, initialRow.info);
        const currentMs = bytes ? readNus3BankDemoStartMs(bytes, stem) : undefined;
        // No bank on disk, or one whose TONE record has no demo-start field: the
        // value has nowhere to go, so the rest of the import proceeds without it.
        // The dialog disables the option in that case, so this is the race only.
        if (currentMs !== undefined) {
          demoStart = {
            key: soundMetadataKey(resolved.filename),
            filename: resolved.filename,
            displayPath: resolved.displayPath,
            stem,
            currentMs,
          };
        }
      } catch {
        // An unreadable or malformed bank is not worth failing the import over.
      }
    }

    // Re-read after file I/O so a concurrent edit becomes the history floor,
    // never something silently overwritten outside the undo timeline.
    const current = get();
    if (current.project.kind !== 'open'
      || current.project.project.root !== initial.project.project.root
      || current.selection.songId !== songId) {
      return { ok: false, message: 'The project or selected song changed before the import completed.' };
    }
    const p = current.project.project;
    if (p.songs.byUniqueId.get(uniqueId)?.id !== songId) {
      return { ok: false, message: 'The selected song is no longer available.' };
    }

    try {
      const fumenBaselines = new Map(p.fumenBaselines);
      // Everything the chart half of the import replaces. With charts unchecked
      // all of it — pending chart operations, the open chart, the selection —
      // stays exactly as the user left it.
      let fumenDrafts = p.fumenDrafts;
      let fumenCreated = p.fumenCreated;
      let fumenRemoved = p.fumenRemoved;
      let selection = current.selection;
      let songSlots = current.songSlots;
      let songDiskSlots = current.songDiskSlots;
      let fumenState = current.fumen;
      let chartState = current.chart;
      let tab = current.ui.tab;

      if (options.charts) {
        for (const baseline of loaded) {
          if (!fumenBaselines.has(baseline.key)) {
            fumenBaselines.set(baseline.key, {
              songId,
              slot: baseline.slot,
              fumen: baseline.fumen,
              bytes: baseline.bytes,
            });
          }
        }

        // Import owns the song's entire chart set. Clear all of its pending chart
        // operations, then rebuild replacements/creations/removals against disk.
        const keepOtherSong = (key: string) => !key.startsWith(`${songId}/`);
        const drafts = new Map([...p.fumenDrafts].filter(([key]) => keepOtherSong(key)));
        const created = new Map([...p.fumenCreated].filter(([key]) => keepOtherSong(key)));
        const removed = new Map([...p.fumenRemoved].filter(([key]) => keepOtherSong(key)));
        const onDisk = diskSlots ?? [];
        const diskNames = new Set(onDisk.map((slot) => slot.filename));

        for (const { chart, slot } of desired) {
          const key = fumenKey(songId, slot.filename);
          if (diskNames.has(slot.filename)) {
            drafts.set(key, chart.fumen);
          } else {
            created.set(key, { songId, slot, fumen: chart.fumen });
          }
        }
        for (const slot of onDisk) {
          if (desiredNames.has(slot.filename)) continue;
          const key = fumenKey(songId, slot.filename);
          removed.set(key, { songId, filename: slot.filename });
        }

        const nextSlots = sortFumenSlots(desired.map(({ slot }) => slot));
        const preferred = nextSlots.find((slot) =>
          slot.difficulty === current.selection.difficulty && slot.player === current.selection.player)
          ?? nextSlots.find((slot) => slot.difficulty === current.selection.difficulty)
          ?? nextSlots[0];
        const selectedChart = desired.find(({ slot }) => slot.filename === preferred?.filename);
        if (!preferred || !selectedChart) return { ok: false, message: 'The imported chart set is empty.' };
        const selectedBytes = fumenBaselines.get(fumenKey(songId, preferred.filename))?.bytes ?? new Uint8Array(0);

        fumenDrafts = drafts;
        fumenCreated = created;
        fumenRemoved = removed;
        selection = { songId, difficulty: preferred.difficulty, player: preferred.player };
        songSlots = nextSlots;
        songDiskSlots = onDisk;
        fumenState = {
          kind: 'ready',
          loaded: { ...preferred, songId, bytes: selectedBytes, fumen: selectedChart.chart.fumen },
        };
        chartState = { ...current.chart, selectedNote: undefined, selectedNotes: undefined, selectedMeasure: undefined, branchFocus: 'all' };
        tab = 'chart';
      }

      // The demo start is a pending bank patch, not a datatable field: record the
      // file's own value as the baseline, then draft the TJA's on top of it.
      let soundMetadataBaselines = p.soundMetadataBaselines;
      let soundMetadataDrafts = p.soundMetadataDrafts;
      if (demoStart && imported.demoStartMs !== undefined) {
        const baseline = p.soundMetadataBaselines.get(demoStart.key) ?? {
          key: demoStart.key,
          songId,
          filename: demoStart.filename,
          displayPath: demoStart.displayPath,
          preferredStem: demoStart.stem,
          demoStartMs: demoStart.currentMs,
        };
        soundMetadataBaselines = new Map(p.soundMetadataBaselines).set(demoStart.key, baseline);
        soundMetadataDrafts = new Map(p.soundMetadataDrafts);
        if (imported.demoStartMs === baseline.demoStartMs) soundMetadataDrafts.delete(demoStart.key);
        else soundMetadataDrafts.set(demoStart.key, { ...baseline, demoStartMs: imported.demoStartMs });
      }

      const datatables = options.metadata
        ? applyTjaImportMetadata(p.datatables, uniqueId, songId, imported)
        : p.datatables;

      const nextProject: OpenProject = {
        ...p,
        datatables,
        songs: songIndexAfterDatatableChange(p.songs, p.datatables, datatables),
        fumenBaselines,
        fumenDrafts,
        fumenCreated,
        fumenRemoved,
        soundMetadataBaselines,
        soundMetadataDrafts,
        undo: pushHistory(p),
        redo: [],
      };
      set({
        project: { kind: 'open', project: nextProject },
        selection,
        songDiskSlots,
        songSlots,
        fumen: fumenState,
        chart: chartState,
        ui: { ...current.ui, tjaImportOpen: false, tab },
        save: { kind: 'idle' },
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  undo: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    if (p.undo.length === 0) return;
    const prev = p.undo[p.undo.length - 1];
    const here: HistorySnapshot = {
      datatables: p.datatables,
      fumenDrafts: p.fumenDrafts,
      fumenCreated: p.fumenCreated,
      fumenRemoved: p.fumenRemoved,
      soundMetadataDrafts: p.soundMetadataDrafts,
    };
    const next: OpenProject = {
      ...p,
      datatables: prev.datatables,
      songs: songIndexAfterDatatableChange(p.songs, p.datatables, prev.datatables),
      fumenDrafts: prev.fumenDrafts,
      fumenCreated: prev.fumenCreated,
      fumenRemoved: prev.fumenRemoved,
      soundMetadataDrafts: prev.soundMetadataDrafts,
      undo: p.undo.slice(0, -1),
      redo: [...p.redo, here],
    };
    set({ project: { kind: 'open', project: next }, save: { kind: 'idle' } });
    refreshFumenAfterHistory(next);
  },

  redo: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    if (p.redo.length === 0) return;
    const fwd = p.redo[p.redo.length - 1];
    const here: HistorySnapshot = {
      datatables: p.datatables,
      fumenDrafts: p.fumenDrafts,
      fumenCreated: p.fumenCreated,
      fumenRemoved: p.fumenRemoved,
      soundMetadataDrafts: p.soundMetadataDrafts,
    };
    const next: OpenProject = {
      ...p,
      datatables: fwd.datatables,
      songs: songIndexAfterDatatableChange(p.songs, p.datatables, fwd.datatables),
      fumenDrafts: fwd.fumenDrafts,
      fumenCreated: fwd.fumenCreated,
      fumenRemoved: fwd.fumenRemoved,
      soundMetadataDrafts: fwd.soundMetadataDrafts,
      undo: [...p.undo, here],
      redo: p.redo.slice(0, -1),
    };
    set({ project: { kind: 'open', project: next }, save: { kind: 'idle' } });
    refreshFumenAfterHistory(next);
  },

  // ── Save ─────────────────────────────────────────────────
  openSaveDialog: (scope) => {
    const dirty = scope === 'order' ? get().isOrderDirty() : get().isSongsDirty();
    if (!dirty) return;
    set({ ui: { ...get().ui, saveDialogOpen: true, saveScope: scope }, save: { kind: 'idle' } });
  },
  closeSaveDialog: () => set({ ui: { ...get().ui, saveDialogOpen: false } }),
  // No project guard: the bundle's Dani Dojo parts come from the standalone dani
  // file slots, so the dialog is useful (and explains what is missing) with no
  // game project open at all.
  openExportDialog: () => set({ ui: { ...get().ui, exportDialogOpen: true } }),
  closeExportDialog: () => set({ ui: { ...get().ui, exportDialogOpen: false } }),

  commitSave: async (scope) => {
    const cur = get().project;
    if (cur.kind !== 'open') return;
    const p = cur.project;
    // Scope the draft to just this page's files (see model/saveScope.ts): the
    // Order save writes only music_order; the Songs save writes everything else
    // (plus a deleted song's music_order rows). Diff/validate against the scoped
    // draft so the other page's pending edits neither block nor reach disk.
    const scopedDraft = scopedDatatables(p.baseline, p.datatables, scope);
    const validation = validate(scopedDraft, p.baseline);
    if (!validation.ok) {
      set({ save: { kind: 'error', message: 'Validation failed — fix the errors before saving.' } });
      return;
    }
    const isSongs = scope === 'songs';
    // Charts and sound banks are Songs-owned; the Order save touches neither.
    // Created charts: write the edited draft if the user touched it since
    // creating, else the seeded clone.
    const createdFumens: DirtyFumenInput[] = isSongs
      ? [...p.fumenCreated].map(([key, c]) => ({
          songId: c.songId,
          filename: c.slot.filename,
          fumen: p.fumenDrafts.get(key) ?? c.fumen,
        }))
      : [];
    const removedFumens: RemovedFumenInput[] = isSongs
      ? [...p.fumenRemoved.values()].map((r) => ({ songId: r.songId, filename: r.filename }))
      : [];
    // Chart invariants (PLAN 3.7): a corrupt edit must not reach disk even though
    // the encoder self-check would still round-trip it byte-perfectly. Check both
    // edited charts and newly created ones.
    const fumenIssues = isSongs
      ? [
          ...validateDirtyFumens(p.fumenBaselines, p.fumenDrafts),
          ...createdFumens.flatMap((c) => validateFumenChart(`fumen/${c.songId}/${c.filename}`, c.fumen)),
        ]
      : [];
    if (fumenIssues.some((i) => i.level === 'error')) {
      set({ save: { kind: 'error', message: 'Chart validation failed — fix the errors before saving.' } });
      return;
    }
    const fumenDiffs = isSongs ? collectFumenDiffs(p.fumenBaselines, p.fumenDrafts) : [];
    const dirtyFumens: DirtyFumenInput[] = fumenDiffs.map((fd) => ({
      songId: fd.songId,
      filename: fd.filename,
      fumen: p.fumenDrafts.get(fd.key)!,
    }));
    const soundDiffs = isSongs ? collectSoundMetadataDiffs(p.soundMetadataBaselines, p.soundMetadataDrafts) : [];
    const dirtySoundBanks: DirtySoundBankInput[] = soundDiffs.map((fd) => {
      const draft = p.soundMetadataDrafts.get(fd.key)!;
      return {
        filename: fd.filename,
        preferredStem: draft.preferredStem,
        demoStartMs: draft.demoStartMs,
      };
    });
    set({ save: { kind: 'saving' } });
    try {
      const result = await saveDatatables(
        p.root,
        p.baseline,
        scopedDraft,
        dirtyFumens,
        createdFumens,
        removedFumens,
        dirtySoundBanks,
      );
      // Re-baseline only the files this scope wrote; the other page's edits stay
      // dirty. History is cleared because undoing across a save would diverge
      // from disk. Saved charts fold into the baseline map and drop out of drafts.
      const cur2 = get().project;
      if (cur2.kind !== 'open') return;
      const p2 = cur2.project;
      const savedDraft = scopedDatatables(p2.baseline, p2.datatables, scope);
      const nextBaseline = isSongs
        ? {
            ...p2.baseline,
            musicinfo: p2.datatables.musicinfo,
            wordlist: p2.datatables.wordlist,
            musicOrder: savedDraft.musicOrder,
          }
        : { ...p2.baseline, musicOrder: p2.datatables.musicOrder };
      const fumenBaselines = new Map(p2.fumenBaselines);
      const fumenDrafts = new Map(p2.fumenDrafts);
      const soundMetadataBaselines = new Map(p2.soundMetadataBaselines);
      const soundMetadataDrafts = new Map(p2.soundMetadataDrafts);
      if (isSongs) {
        for (const fd of fumenDiffs) {
          const saved = fumenDrafts.get(fd.key);
          const base = fumenBaselines.get(fd.key);
          if (saved && base) fumenBaselines.set(fd.key, { ...base, fumen: saved });
          fumenDrafts.delete(fd.key);
        }
        for (const sd of soundDiffs) {
          const saved = soundMetadataDrafts.get(sd.key);
          if (saved) soundMetadataBaselines.set(sd.key, saved);
          soundMetadataDrafts.delete(sd.key);
        }
        // Created charts are now real files; drop their drafts + pending state and
        // let them lazy-load from disk on the next view.
        for (const key of p2.fumenCreated.keys()) fumenDrafts.delete(key);
        // Removed charts are gone; clear any stale baseline so a re-view re-reads.
        for (const key of p2.fumenRemoved.keys()) {
          fumenBaselines.delete(key);
          fumenDrafts.delete(key);
        }
      }
      set({
        project: {
          kind: 'open',
          project: {
            ...p2,
            baseline: nextBaseline,
            fumenBaselines,
            fumenDrafts,
            fumenCreated: isSongs ? new Map() : p2.fumenCreated,
            fumenRemoved: isSongs ? new Map() : p2.fumenRemoved,
            soundMetadataBaselines,
            soundMetadataDrafts,
            undo: [],
            redo: [],
          },
        },
        save: { kind: 'done', result },
        ui: { ...get().ui, saveDialogOpen: false },
      });
    } catch (e) {
      set({ save: { kind: 'error', message: (e as Error).message } });
    }
  },
  isSongsDirty: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return false;
    const p = cur.project;
    return (
      songsDatatableDirty(p.baseline, p.datatables) ||
      collectFumenDiffs(p.fumenBaselines, p.fumenDrafts).length > 0 ||
      collectSoundMetadataDiffs(p.soundMetadataBaselines, p.soundMetadataDrafts).length > 0 ||
      p.fumenCreated.size > 0 ||
      p.fumenRemoved.size > 0
    );
  },
  isOrderDirty: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return false;
    return orderScopeDirty(cur.project.baseline, cur.project.datatables);
  },

  // ── Dani Dojo ────────────────────────────────────────────
  canOpenDani: () => canOpenDaniFile(),

  daniInitFromStorage: async () => {
    for (const section of ['normal', 'gaiden'] as const) {
      if (get().dani[section].loaded) continue; // already loaded / New'd this session
      let handle: FileSystemFileHandle | undefined;
      try { handle = await loadDaniFileHandle(section); } catch { handle = undefined; }
      if (!handle) continue;
      let perm: PermissionState;
      try { perm = await queryDaniReadPermission(handle); } catch { continue; }
      if (perm !== 'granted') continue; // needs a user gesture — the user re-loads manually
      try {
        const text = await (await handle.getFile()).text();
        const config = parseDanConfig(text);
        const st = get().dani; // re-read: the user may have acted while we awaited
        if (st[section].loaded) continue;
        const slot: DaniFileSlot = {
          loaded: true, fileName: handle.name, handle, baseline: config, draft: config, undo: [], redo: [],
        };
        const sel = st.sel ?? (config.length ? { section, danId: config[0].danId } : undefined);
        set({ dani: { ...st, [section]: slot, sel } });
      } catch {
        void clearDaniFileHandle(section); // renamed/deleted/unparseable since last session
      }
    }
  },

  daniLoad: async (section) => {
    const result = await openDanFile();
    if (!result.ok) {
      if (result.error.kind === 'cancelled') return;
      set({ dani: { ...get().dani, error: daniErrorMessage(result.error) } });
      return;
    }
    const { handle, fileName, config } = result.file;
    const slot: DaniFileSlot = {
      loaded: true, fileName, handle, baseline: config, draft: config, undo: [], redo: [],
    };
    const sel: DaniSelection | undefined = config.length ? { section, danId: config[0].danId } : undefined;
    const st = get().dani;
    set({ dani: { ...st, [section]: slot, sel: sel ?? st.sel, error: undefined } });
    void saveDaniFileHandle(section, handle); // remember for reopening after reload
  },

  daniNew: (section) => {
    const scaffold = section === 'normal' ? scaffoldNormalConfig() : scaffoldGaidenConfig();
    const fileName = section === 'normal' ? 'dan_data.json' : 'gaiden_data.json';
    // baseline stays empty so the seeded dan reads as new/unsaved until first Save.
    const slot: DaniFileSlot = {
      loaded: true, fileName, handle: undefined, baseline: [], draft: scaffold, undo: [], redo: [],
    };
    set({ dani: { ...get().dani, [section]: slot, sel: { section, danId: scaffold[0].danId }, error: undefined } });
    void clearDaniFileHandle(section); // a New file isn't on disk yet — drop any stale handle
  },

  daniClose: (section) => {
    const st = get().dani;
    const otherSection: DanSection = section === 'normal' ? 'gaiden' : 'normal';
    const other = st[otherSection];
    const fallbackSel =
      other.loaded && other.draft.length > 0
        ? { section: otherSection, danId: other.draft[0].danId }
        : undefined;
    const sel = st.sel?.section === section ? fallbackSel : st.sel;
    set({
      dani: {
        ...st,
        [section]: emptyDaniSlot(section === 'normal' ? 'dan_data.json' : 'gaiden_data.json'),
        sel,
        picker: st.picker?.section === section ? undefined : st.picker,
        saveOpen: st.saveOpen === section ? undefined : st.saveOpen,
        error: undefined,
      },
    });
    void clearDaniFileHandle(section);
  },

  daniSelectDan: (section, danId) => set({ dani: { ...get().dani, sel: { section, danId } } }),

  daniSetGaidenTitle: (danId, title) => daniEditDan('gaiden', danId, (c) => setDanTitle(c, danId, title)),
  daniSetCourse: (section, danId, slot, level) =>
    daniEditDan(section, danId, (c) => setOdaiSongLevel(c, danId, slot, level)),
  daniSetHidden: (section, danId, slot, hidden) =>
    daniEditDan(section, danId, (c) => setOdaiSongHidden(c, danId, slot, hidden)),
  daniAddBorder: (section, danId) => daniEditDan(section, danId, (c) => addBorder(c, danId)),
  daniRemoveBorder: (section, danId, borderIndex) =>
    daniEditDan(section, danId, (c) => removeBorder(c, danId, borderIndex)),
  daniSetBorderType: (section, danId, borderIndex, borderType) =>
    daniEditDan(section, danId, (c) => setBorderType(c, danId, borderIndex, borderType)),
  daniSetBorderOdaiType: (section, danId, borderIndex, odaiType) =>
    daniEditDan(section, danId, (c) => setBorderOdaiType(c, danId, borderIndex, odaiType)),
  daniSetBorderValue: (section, danId, borderIndex, key, value) =>
    daniEditDan(section, danId, (c) => setBorderValue(c, danId, borderIndex, key, value)),
  daniClearDan: (section, danId) => daniEditDan(section, danId, (c) => clearDan(c, danId)),

  daniAddDan: (section) => {
    const before = get().dani[section].draft;
    const after = section === 'normal' ? addNormalDan(before) : addGaidenDan(before);
    if (after === before) return; // normal at the 19-dan cap
    const danId = after[after.length - 1].danId;
    daniMutateSlot(section, () => after, { section, danId });
  },

  daniRemoveDan: (section) => {
    const st = get().dani;
    const danId = st.sel?.section === section ? st.sel.danId : undefined;
    if (danId === undefined) return;
    const before = st[section].draft;
    const after = removeTrailingDan(before, danId);
    if (after === before) return; // not the trailing dan
    const sel: DaniSelection | null = after.length ? { section, danId: after[after.length - 1].danId } : null;
    daniMutateSlot(section, () => after, sel);
  },

  daniUndo: () => {
    const st = get().dani;
    const section = st.sel?.section;
    if (!section) return;
    const slot = st[section];
    if (slot.undo.length === 0) return;
    const prev = slot.undo[slot.undo.length - 1];
    const newSlot: DaniFileSlot = {
      ...slot, draft: prev, undo: slot.undo.slice(0, -1), redo: [...slot.redo, slot.draft],
    };
    const sel = clampDaniSel(st.sel, section, prev);
    set({ dani: { ...st, [section]: newSlot, sel, error: undefined } });
  },

  daniRedo: () => {
    const st = get().dani;
    const section = st.sel?.section;
    if (!section) return;
    const slot = st[section];
    if (slot.redo.length === 0) return;
    const fwd = slot.redo[slot.redo.length - 1];
    const newSlot: DaniFileSlot = {
      ...slot, draft: fwd, redo: slot.redo.slice(0, -1), undo: [...slot.undo, slot.draft],
    };
    const sel = clampDaniSel(st.sel, section, fwd);
    set({ dani: { ...st, [section]: newSlot, sel, error: undefined } });
  },

  daniSetSongNo: (section, danId, slot, songNo) =>
    daniEditDan(section, danId, (c) => setOdaiSongNo(c, danId, slot, songNo)),
  daniAddSong: (section, danId) => daniEditDan(section, danId, (c) => addOdaiSong(c, danId)),
  daniRemoveSong: (section, danId, slot) => daniEditDan(section, danId, (c) => removeOdaiSong(c, danId, slot)),
  daniOpenPicker: (section, danId, slot) =>
    set({ dani: { ...get().dani, picker: { section, danId, slot, query: '' } } }),
  daniClosePicker: () => set({ dani: { ...get().dani, picker: undefined } }),
  daniSetPickerQuery: (query) => {
    const st = get().dani;
    if (!st.picker) return;
    set({ dani: { ...st, picker: { ...st.picker, query } } });
  },
  daniPickSong: (songNo) => {
    const pk = get().dani.picker;
    if (!pk) return;
    daniEditDan(pk.section, pk.danId, (c) => setOdaiSongNo(c, pk.danId, pk.slot, songNo));
    set({ dani: { ...get().dani, picker: undefined } });
  },

  daniOpenSave: (section) => set({ dani: { ...get().dani, saveOpen: section, error: undefined } }),
  daniCloseSave: () => set({ dani: { ...get().dani, saveOpen: undefined } }),
  daniCommitSave: async () => {
    const st = get().dani;
    const section = st.saveOpen;
    if (!section) return;
    const slot = st[section];
    const draft = slot.draft;
    const proj = get().project;
    const resolve = makeDanSongResolver(proj.kind === 'open' ? proj.project.songs : undefined, get().ui.locale);
    if (validateSection(draft, resolve, section).errors.length > 0) {
      set({ dani: { ...get().dani, error: 'Fix the errors before saving.' } });
      return;
    }
    set({ dani: { ...get().dani, saving: true, error: undefined } });
    try {
      let handle = slot.handle;
      if (handle) {
        try {
          await saveDanFile(handle, draft);
        } catch (e) {
          if (e instanceof DaniPermissionError) {
            // Write refused on the bound handle — fall back to a Save As.
            const alt = await saveDanFileAs(draft, slot.fileName);
            if (!alt.ok) {
              if (alt.error.kind === 'cancelled') { set({ dani: { ...get().dani, saving: false } }); return; }
              throw new Error(daniErrorMessage(alt.error));
            }
            handle = alt.handle;
          } else {
            throw e;
          }
        }
      } else {
        const alt = await saveDanFileAs(draft, slot.fileName);
        if (!alt.ok) {
          if (alt.error.kind === 'cancelled') { set({ dani: { ...get().dani, saving: false } }); return; }
          throw new Error(daniErrorMessage(alt.error));
        }
        handle = alt.handle;
      }
      const st2 = get().dani;
      const savedSlot: DaniFileSlot = {
        loaded: true, fileName: handle.name, handle,
        baseline: draft, draft, undo: [], redo: [],
      };
      set({ dani: { ...st2, [section]: savedSlot, saving: false, saveOpen: undefined } });
      void saveDaniFileHandle(section, handle); // remember (esp. a Save As's new handle)
    } catch (e) {
      set({ dani: { ...get().dani, saving: false, error: (e as Error).message } });
    }
  },

  // ── Derived selectors ────────────────────────────────────
  getDiff: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return undefined;
    return diffDatatables(cur.project.baseline, cur.project.datatables);
  },
  getFumenDiffs: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return [];
    return collectFumenDiffs(cur.project.fumenBaselines, cur.project.fumenDrafts);
  },
  getEditCount: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return 0;
    const p = cur.project;
    const dt = diffDatatables(p.baseline, p.datatables).totalEdits;
    const fm = collectFumenDiffs(p.fumenBaselines, p.fumenDrafts).length;
    const sm = collectSoundMetadataDiffs(p.soundMetadataBaselines, p.soundMetadataDrafts).length;
    return dt + fm + sm + p.fumenCreated.size + p.fumenRemoved.size;
  },
  getValidation: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return undefined;
    return validate(cur.project.datatables, cur.project.baseline);
  },
  getFumenValidation: () => {
    const cur = get().project;
    if (cur.kind !== 'open') return [];
    const p = cur.project;
    const issues = validateDirtyFumens(p.fumenBaselines, p.fumenDrafts);
    for (const [key, c] of p.fumenCreated) {
      const fumen = p.fumenDrafts.get(key) ?? c.fumen;
      issues.push(...validateFumenChart(`fumen/${c.songId}/${c.slot.filename}`, fumen));
    }
    return issues;
  },
  };
});
