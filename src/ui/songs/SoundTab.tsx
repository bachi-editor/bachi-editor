import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  allocateNus3BankId,
  loadSoundFileInfo,
  readSoundBankBytes,
  resolveSoundFile,
  SoundFileInfo,
  SoundWriteResult,
} from '../../fs/sound';
import { useAppStore } from '../../model/store';
import { SongRow } from '../../model/songlist';
import { useT } from '../../i18n';
import { ChartSlotSelect } from './ChartSlotSelect';
import { Icon } from '../shell/Icon';
import { ConfirmDialog } from '../shell/ConfirmDialog';
import { ContextMenu, type ContextMenuAnchor } from '../shell/ContextMenu';
import { InfoHint } from '../shell/InfoHint';
import { ScoreCanvas } from '../fumen/ScoreCanvas';
import { ScaleControls } from '../fumen/ScaleControls';
import { chartIntroDelayMs } from '../../model/fumenTiming';
import {
  clamp,
  decodeAudioFile,
  encodeImportedSound,
  soundbankPlayer,
  soundCacheKey,
  type LoadedSound,
  type PlayerState,
  type WaveformPeaks,
} from '../../audio';
import { isNus3BankBytes, readNus3BankDemoStartMs } from '../../codec';
import { soundMetadataKey } from '../../model/soundMetadata';
import { loadG719EncoderWasm } from '../../fs/idb';
import songTemplateUrl from '../../assets/song-template.nus3bank?url';

type InfoState =
  | { kind: 'loading' }
  | { kind: 'ready'; info: SoundFileInfo }
  | { kind: 'error'; message: string };

type ActionState =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const BAR_COUNT = 300;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[idx]}`;
}

function formatDate(ms: number | undefined): string {
  if (!ms) return 'unknown';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const tenths = Math.floor((total * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

function formatDelta(result: SoundWriteResult): string {
  return result.byteDelta >= 0 ? `+${formatBytes(result.byteDelta)}` : `-${formatBytes(Math.abs(result.byteDelta))}`;
}

/** Downsample the decode peaks into normalised bar heights for the waveform. */
function barsFromPeaks(peaks: WaveformPeaks, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (peaks.length === 0) return out;
  const per = peaks.length / n;
  let globalMax = 1e-6;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let amp = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      amp = Math.max(amp, Math.abs(peaks.min[j]), Math.abs(peaks.max[j]));
    }
    out[i] = amp;
    if (amp > globalMax) globalMax = amp;
  }
  for (let i = 0; i < n; i++) out[i] /= globalMax;
  return out;
}

/** Clamp to the decoded duration when known; metadata editing also works muted. */
function clampDemoStart(ms: number, durationMs?: number): number {
  const limit = durationMs !== undefined && Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : Number.POSITIVE_INFINITY;
  return clamp(Math.round(Number.isFinite(ms) ? ms : 0), 0, limit);
}

function formatMsDisplay(ms: number): string {
  const rounded = Math.round(ms);
  return rounded > 0 ? `+${rounded} ms` : `${rounded} ms`;
}

function formatMsEdit(ms: number): string {
  return String(Math.round(ms));
}

function parseMsInput(raw: string): number | undefined {
  const match = raw.trim().match(/^([+-]?\d+)\s*(?:ms)?$/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface EditableMsInputProps {
  valueMs: number;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (ms: number) => void;
}

function EditableMsInput({ valueMs, disabled, ariaLabel, onCommit }: EditableMsInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatMsEdit(valueMs));

  useEffect(() => {
    if (!editing) setDraft(formatMsEdit(valueMs));
  }, [editing, valueMs]);

  useEffect(() => {
    if (!editing) return;
    const id = window.requestAnimationFrame(() => ref.current?.select());
    return () => window.cancelAnimationFrame(id);
  }, [editing]);

  const beginEdit = () => {
    if (disabled || editing) return;
    skipBlurCommit.current = false;
    setDraft(formatMsEdit(valueMs));
    setEditing(true);
  };

  const finishEdit = () => {
    if (!editing) return;
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      setEditing(false);
      setDraft(formatMsEdit(valueMs));
      return;
    }
    const parsed = parseMsInput(draft);
    setEditing(false);
    if (parsed === undefined) {
      setDraft(formatMsEdit(valueMs));
      return;
    }
    if (parsed !== Math.round(valueMs)) onCommit(parsed);
  };

  const cancelEdit = () => {
    skipBlurCommit.current = true;
    setEditing(false);
    setDraft(formatMsEdit(valueMs));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      cancelEdit();
      e.currentTarget.blur();
    }
  };

  return (
    <input
      ref={ref}
      aria-label={ariaLabel}
      disabled={disabled}
      readOnly={!editing}
      value={editing ? draft : formatMsDisplay(valueMs)}
      onFocus={beginEdit}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={finishEdit}
      onKeyDown={onKeyDown}
    />
  );
}

interface WaveformProps {
  bars: number[];
  durationMs: number;
  currentMs: number;
  /** Saved/dragged demo start (ms); rendered as a single red marker line. */
  demoStartMs: number;
  interactive: boolean;
  /** Decoding-in-progress skeleton: shimmer the bars, hide marker/scrub/time. */
  loading?: boolean;
  /** Press anywhere on the bars: begins a playhead scrub. */
  onSeekStart: () => void;
  /** Live playhead position while scrubbing (visual only). */
  onSeekDraft: (ms: number) => void;
  /** Final playhead position; the transport only moves here. */
  onSeekCommit: (ms: number) => void;
  onDemoDraft: (ms: number) => void;
  onDemoCommit: (ms: number) => void;
}

function Waveform({
  bars,
  durationMs,
  currentMs,
  demoStartMs,
  interactive,
  loading = false,
  onSeekStart,
  onSeekDraft,
  onSeekCommit,
  onDemoDraft,
  onDemoCommit,
}: WaveformProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // Right-click actions for the playhead itself (the bars carry none).
  const [headMenu, setHeadMenu] = useState<ContextMenuAnchor | undefined>();
  // Either marker being dragged. The scrub cursor is scoped to the two markers,
  // so an open drag has to force it across the whole surface — the pointer
  // wanders off the 2px line it grabbed almost immediately.
  const [dragging, setDragging] = useState(false);
  const frac = (ms: number) => (durationMs > 0 ? clamp(ms / durationMs, 0, 1) : 0);
  const demo = frac(demoStartMs);
  const head = frac(currentMs);

  const openHeadMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setHeadMenu({ x: e.clientX, y: e.clientY });
  };

  const xToMs = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs;
  };

  // Pressing anywhere on the waveform grabs the playhead — the press itself is
  // already a scrub, so no precise aim at the 2px line is needed. Same shape as
  // the demo-marker drag below: live draft while moving, one commit on release.
  const onContainerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Primary button only — a right-click is for the menu below, and must never
    // move the playhead on its way there.
    if (!interactive || e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = xToMs(e.clientX);
    setDragging(true);
    onSeekStart();
    onSeekDraft(latest);
    const move = (ev: PointerEvent) => {
      latest = xToMs(ev.clientX);
      onSeekDraft(latest);
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      onSeekCommit(latest);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Drag the red marker to set the demo start; bubbling is stopped so the drag
  // doesn't also seek the transport.
  const beginDemoDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = demoStartMs;
    let moved = false;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      latest = clamp(xToMs(ev.clientX), 0, durationMs);
      moved = true;
      onDemoDraft(latest);
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setDragging(false);
      if (moved) onDemoCommit(latest);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <>
      <div
        className={`tk-wave${interactive ? ' is-live' : ''}${dragging ? ' is-dragging' : ''}`}
        ref={ref}
        onPointerDown={onContainerDown}
      >
        <div className="tk-wave-bars">
          {bars.map((h, i) => (
            <span key={i} className={`tk-wbar${loading ? ' tk-shim' : ''}`} style={{ height: `${Math.max(4, h * 100)}%` }} />
          ))}
        </div>
        {!loading && (
          <>
            <div
              className="tk-wave-demo"
              style={{ left: `${demo * 100}%` }}
              onPointerDown={beginDemoDrag}
              title={t('sound.demoStart')}
            />
            <div
              className="tk-scrub-head"
              style={{ left: `${head * 100}%` }}
              onContextMenu={interactive ? openHeadMenu : undefined}
            />
            <div className="tk-wave-time" style={{ left: 8 }}>{formatTime(currentMs)}</div>
            <div className="tk-wave-time" style={{ right: 8 }}>{formatTime(durationMs)}</div>
          </>
        )}
      </div>
      {/* Kept outside `.tk-wave`: that surface clips its overflow and grabs the
          playhead on press, and neither may apply to a menu floating above it. */}
      {headMenu && (
        <ContextMenu anchor={headMenu} onClose={() => setHeadMenu(undefined)}>
          {(close) => (
            <button
              className="tk-menu-item"
              role="menuitem"
              onClick={() => {
                onDemoCommit(currentMs);
                close();
              }}
            >
              <span className="ic"><Icon name="flag" size={15} /></span>
              {t('sound.setAsDemoStart')}
            </button>
          )}
        </ContextMenu>
      )}
    </>
  );
}

// Deterministic skeleton waveform heights (0..1) for the decoding shimmer.
const SKELETON_BARS = Array.from({ length: 80 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 0.7)));

export function SoundTab({ row }: { row: SongRow }) {
  const project = useAppStore((s) => s.project);
  const replaceSongAudio = useAppStore((s) => s.replaceSongAudio);
  const removeSongAudio = useAppStore((s) => s.removeSongAudio);
  const rememberSoundBankMetadata = useAppStore((s) => s.rememberSoundBankMetadata);
  const editSoundBankDemoStart = useAppStore((s) => s.editSoundBankDemoStart);
  const editCurrentFumenOffset = useAppStore((s) => s.editCurrentFumenOffset);
  const chart = useAppStore((s) => s.fumen);
  const zoom = useAppStore((s) => s.ui.zoom);
  const noteScale = useAppStore((s) => s.ui.noteScale);
  const decoderRevision = useAppStore((s) => s.ui.g719DecoderRevision);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const root = project.kind === 'open' ? project.project.root : undefined;
  const inventorySignal = project.kind === 'open' ? project.project.assets.soundFiles : undefined;
  const resolved = useMemo(() => resolveSoundFile(row.info), [row.info]);
  const metadataKey = useMemo(() => soundMetadataKey(resolved.filename), [resolved.filename]);
  const soundMetadata =
    project.kind === 'open'
      ? project.project.soundMetadataDrafts.get(metadataKey)
        ?? project.project.soundMetadataBaselines.get(metadataKey)
      : undefined;
  const [infoState, setInfoState] = useState<InfoState>({ kind: 'loading' });
  const [action, setAction] = useState<ActionState>({ kind: 'idle' });
  const [playerState, setPlayerState] = useState<PlayerState>(() => soundbankPlayer.getState());
  const [loaded, setLoaded] = useState<LoadedSound | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  // Live demo-start while dragging the marker; undefined falls back to the saved value.
  const [draftDemoStartMs, setDraftDemoStartMs] = useState<number | undefined>(undefined);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  // Live playhead position while scrubbing the waveform; undefined when idle, so
  // the head falls back to the transport's own time.
  const [scrubMs, setScrubMs] = useState<number | undefined>(undefined);
  // Playback is suspended for the length of a scrub (seeking restarts the buffer
  // source, which would stutter once per pointer move) and resumed on release.
  const resumeAfterScrub = useRef(false);

  const info = infoState.kind === 'ready' ? infoState.info : undefined;
  const exists = info?.exists ?? false;
  const busy = action.kind === 'busy';
  const cacheKey =
    info && exists ? soundCacheKey({ sha256: info.sha256, size: info.size, modified: info.modified }) : undefined;
  const stem = resolved.filename.replace(/\.nus3bank$/i, '');

  // Subscribe to the shared player; stop playback when leaving the tab.
  useEffect(() => {
    setPlayerState(soundbankPlayer.getState());
    const unsubscribe = soundbankPlayer.subscribe(setPlayerState);
    return () => {
      unsubscribe();
      soundbankPlayer.unbind();
    };
  }, []);

  // Load file metadata (size / sha / modified) for the selected song.
  useEffect(() => {
    let cancelled = false;
    if (!root) return;
    setInfoState({ kind: 'loading' });
    loadSoundFileInfo(root, row.info)
      .then((nextInfo) => {
        if (!cancelled) setInfoState({ kind: 'ready', info: nextInfo });
      })
      .catch((e) => {
        if (!cancelled) setInfoState({ kind: 'error', message: (e as Error).message });
      });
    return () => { cancelled = true; };
  }, [root, row.info, inventorySignal]);

  // Decode + bind the bank whenever the resolved file (by content key) changes.
  useEffect(() => {
    let cancelled = false;
    if (!root || !exists || !cacheKey) {
      soundbankPlayer.unbind();
      setLoaded(null);
      return;
    }
    setLoaded(null);
    (async () => {
      const bytes = await readSoundBankBytes(root, row.info);
      if (cancelled || !bytes) return;
      try {
        const demoStartMs = readNus3BankDemoStartMs(bytes, stem);
        if (!cancelled && demoStartMs !== undefined) {
          rememberSoundBankMetadata({
            songId: row.id,
            filename: resolved.filename,
            displayPath: resolved.displayPath,
            preferredStem: stem,
            demoStartMs,
          });
        }
      } catch {
        // Playback may still work for malformed/unsupported metadata; surface
        // decode errors through the player instead of failing the whole tab.
      }
      try {
        const sound = await soundbankPlayer.load(cacheKey, bytes, stem);
        if (!cancelled) setLoaded(sound);
      } catch {
        // Player state already reflects the typed decode error.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, cacheKey, exists, row.info, row.id, resolved.filename, resolved.displayPath, stem, rememberSoundBankMetadata, decoderRevision]);

  // Drive the scrub head while playing; read once on every transport change.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setCurrentMs(soundbankPlayer.getCurrentTime() * 1000);
      raf = requestAnimationFrame(tick);
    };
    if (playerState.playing) raf = requestAnimationFrame(tick);
    else setCurrentMs(soundbankPlayer.getCurrentTime() * 1000);
    return () => cancelAnimationFrame(raf);
  }, [playerState.playing]);

  const durationMs = (loaded?.duration ?? playerState.duration) * 1000;
  // The position everything on screen reads from: the scrub draft while a drag is
  // open, the transport's own time otherwise.
  const headMs = scrubMs ?? currentMs;
  const decodedDurationMs = durationMs > 0 ? durationMs : undefined;
  const savedDemoStartMs = soundMetadata?.demoStartMs ?? 0;
  const demoStartMs = clampDemoStart(draftDemoStartMs ?? savedDemoStartMs, decodedDurationMs);
  // The raw editable fumen field: measure 0's stored `offset`. Shown in the
  // nudge control and written back to the chart on edit.
  const fumenOffsetMs = chart.kind === 'ready' ? Math.round(chart.loaded.fumen.measures[0]?.offset ?? 0) : 0;
  const fumenOffsetEditable = chart.kind === 'ready' && chart.loaded.fumen.measures.length > 0;
  // The audio plays from its own t=0, so chart time = audio time minus the intro
  // delay before the first downbeat. That delay is NOT just offset[0]: the fumen
  // `offset` is the scroll-appearance time, one nominal 4-beat screen ahead of
  // judgment, so the true downbeat is offset[0] + 4*beatMs(bpm[0]) (see
  // chartIntroDelayMs). Subtracting it tracks the notes in real time.
  const introDelayMs = chart.kind === 'ready' ? Math.round(chartIntroDelayMs(chart.loaded.fumen)) : 0;
  const decoding = playerState.status === 'decoding';
  const ready = playerState.status === 'ready' && !!loaded && playerState.cacheKey === cacheKey;
  const playbackError = playerState.status === 'error' ? playerState.error : undefined;
  const demoStartEditable = exists && !!soundMetadata;
  const bars = useMemo(() => (loaded ? barsFromPeaks(loaded.peaks, BAR_COUNT) : []), [loaded]);
  // A real failure on a bank that exists (decode error) or a filesystem read
  // error — distinct from the calm "no bank on disk" case, which is not an error.
  const audioError = playbackError ?? (infoState.kind === 'error' ? infoState.message : undefined);
  const showAudioWarning = !!audioError && !decoding;

  useEffect(() => {
    setDraftDemoStartMs(undefined);
  }, [row.uniqueId, savedDemoStartMs, durationMs]);

  useEffect(() => {
    setScrubMs(undefined);
    resumeAfterScrub.current = false;
  }, [row.uniqueId]);

  const commitDemoStart = (ms: number) => {
    const next = clampDemoStart(ms, decodedDurationMs);
    setDraftDemoStartMs(undefined);
    if (!soundMetadata) {
      setAction({ kind: 'error', message: t('sound.noDemoField', { path: resolved.displayPath }) });
      return;
    }
    editSoundBankDemoStart({ ...soundMetadata, demoStartMs: next });
  };

  const togglePlay = async () => {
    if (!ready) return;
    if (playerState.playing) {
      soundbankPlayer.pause();
      return;
    }
    await soundbankPlayer.ensureContextResumed();
    soundbankPlayer.play();
  };

  const onStop = () => {
    soundbankPlayer.stop();
  };

  const onSeekMs = (ms: number) => {
    soundbankPlayer.seek(ms / 1000);
    setCurrentMs(clamp(ms, 0, durationMs));
  };

  const onScrubStart = () => {
    resumeAfterScrub.current = soundbankPlayer.getState().playing;
    if (resumeAfterScrub.current) soundbankPlayer.pause();
  };

  const onScrubCommit = (ms: number) => {
    setScrubMs(undefined);
    onSeekMs(ms);
    if (resumeAfterScrub.current) {
      resumeAfterScrub.current = false;
      soundbankPlayer.play();
    }
  };

  // Demo plays from the saved demo-start through to the natural end of the
  // track. The bank stores only a start (no end tag), so there's nothing to
  // stop at — the buffer source's onended handler clears the playing state.
  const onDemo = async () => {
    if (!ready) return;
    await soundbankPlayer.ensureContextResumed();
    soundbankPlayer.play(demoStartMs / 1000);
  };

  const nudgeStart = (deltaMs: number) => commitDemoStart(demoStartMs + deltaMs);

  const nudgeFumenOffset = (deltaMs: number) => {
    editCurrentFumenOffset(fumenOffsetMs + deltaMs);
  };

  /** Game-native bank: written through byte-for-byte. */
  const replaceWithBank = async (file: File) => {
    onStop();
    setAction({ kind: 'busy', label: t('sound.replacing') });
    try {
      const result = await replaceSongAudio(row.uniqueId, file);
      soundbankPlayer.unbind();
      setAction({ kind: 'done', message: t('sound.replaced', { file: result.filename, delta: formatDelta(result) }) });
    } catch (err) {
      setAction({ kind: 'error', message: (err as Error).message });
    }
  };

  /** Everything else: decode with the browser, re-encode to G.719, wrap in a bank. */
  const convertToBank = async (file: File) => {
    if (!root) return;
    onStop();
    setAction({ kind: 'busy', label: t('sound.converting', { file: file.name }) });

    let encoder: Awaited<ReturnType<typeof loadG719EncoderWasm>>;
    try {
      encoder = await loadG719EncoderWasm();
    } catch {
      encoder = undefined;
    }
    if (!encoder) {
      setAction({ kind: 'error', message: t('sound.encoderMissing') });
      return;
    }

    let decoded: Awaited<ReturnType<typeof decodeAudioFile>>;
    try {
      decoded = await decodeAudioFile(file);
    } catch (err) {
      setAction({
        kind: 'error',
        message: t('sound.decodeInputError', { file: file.name, reason: (err as Error).message }),
      });
      return;
    }

    try {
      const existingBank = await readSoundBankBytes(root, row.info);
      let templateBank: Uint8Array | undefined;
      let bankId: number | undefined;
      if (!existingBank) {
        bankId = await allocateNus3BankId(root, inventorySignal ?? [], row.uniqueId);
        const response = await fetch(songTemplateUrl);
        if (!response.ok) throw new Error(`Could not load the nus3bank template (${response.status}).`);
        templateBank = new Uint8Array(await response.arrayBuffer());
      }
      const encoded = await encodeImportedSound({
        ...decoded,
        g719Wasm: new Uint8Array(encoder.bytes),
        existingBank,
        templateBank,
        preferredStem: stem,
        songId: row.id,
        uniqueId: row.uniqueId,
        bankId,
        demoStartMs: savedDemoStartMs,
      });
      const output = new File(
        [encoded.bankBytes.buffer],
        resolved.filename,
        { type: 'application/octet-stream' },
      );
      const result = await replaceSongAudio(row.uniqueId, output);
      soundbankPlayer.unbind();
      setAction({
        kind: 'done',
        message: t('sound.converted', {
          file: file.name,
          bank: result.filename,
          duration: formatTime(encoded.durationSeconds * 1000),
          delta: formatDelta(result),
        }),
      });
    } catch (err) {
      setAction({ kind: 'error', message: t('sound.encodeInputError', { reason: (err as Error).message }) });
    }
  };

  // One picker, two paths, chosen from the file's own header. The inputs never
  // overlap: the browser cannot decode a nus3bank, and a bare OGG/WAV/MP3 copied
  // into sound/ is not something the game can read — so the NUS3 magic is the
  // whole discriminator.
  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (isNus3BankBytes(head)) await replaceWithBank(file);
    else await convertToBank(file);
  };

  const onRemove = async () => {
    setRemoveConfirmOpen(false);
    if (!exists) return;
    onStop();
    setAction({ kind: 'busy', label: t('sound.removing') });
    try {
      const result = await removeSongAudio(row.uniqueId);
      soundbankPlayer.unbind();
      setAction({ kind: 'done', message: t('sound.removed', { file: result.filename, delta: formatDelta(result) }) });
    } catch (err) {
      setAction({ kind: 'error', message: (err as Error).message });
    }
  };

  const channelLabel =
    loaded?.channels === 1 ? t('sound.mono') : loaded?.channels === 2 ? t('sound.stereo') : `${loaded?.channels}ch`;
  const codecFact = ready && loaded
    ? `${loaded.codec.split(' ')[0]} · ${channelLabel} ${Math.round(loaded.sampleRate / 1000)} kHz`
    : decoding
      ? t('sound.statusDecoding')
      : playbackError
        ? t('sound.statusUnsupported')
        : exists ? '—' : t('sound.statusMissing');

  return (
    <div className="tk-snd-main">
      <div className="tk-snd-hero">
        <div className="tk-snd-herorow">
          <button className="tk-snd-play" onClick={togglePlay} disabled={!ready} aria-label={playerState.playing ? t('sound.pause') : t('sound.play')}>
            <Icon name={playerState.playing ? 'pause' : 'play'} size={20} />
          </button>
          <button className="tk-tp-skip" onClick={onStop} disabled={!ready} aria-label={t('sound.stop')}>
            <Icon name="stop" size={15} />
          </button>
          <div className="tk-tp-time">
            {formatTime(headMs)} <span className="tot">/ {formatTime(durationMs)}</span>
          </div>
          <div className="tk-tooldiv" />
          <div className="tk-snd-titles">
            <div className="f" style={{ marginTop: 0 }}>
              <span className="tk-mono">{resolved.displayPath}</span>
              <span><b>nus3bank</b></span>
              {infoState.kind === 'loading' && <span className="tk-tag none">{t('sound.checking')}</span>}
              {exists && <span className="tk-tag ok"><Icon name="check" size={12} /> {t('sound.onDisk')}</span>}
              {infoState.kind === 'ready' && !exists && <span className="tk-tag miss">{t('sound.noAudio')}</span>}
              {!resolved.declared && <span className="tk-tag none">{t('sound.byConvention')}</span>}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <input
            ref={inputRef}
            type="file"
            accept=".nus3bank,application/octet-stream,audio/*,.ogg,.oga,.wav,.wave,.mp3,.flac,.m4a,.aac"
            onChange={onPickFile}
            style={{ display: 'none' }}
          />
          <button
            className="tk-btn tk-btn-primary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            title={t('sound.importAudioHint')}
          >
            <Icon name="import" /> {t('sound.importAudio')}
          </button>
          <button
            className="tk-btn tk-btn-danger"
            onClick={() => setRemoveConfirmOpen(true)}
            disabled={!exists || busy}
          >
            <Icon name="trash" /> {t('common.remove')}
          </button>
        </div>

        <div className="tk-snd-facts">
          <div>
            <span>{t('sound.size')}</span>
            <b>{infoState.kind === 'loading' ? t('sound.checkingDots') : exists && info ? formatBytes(info.size) : t('sound.statusMissing')}</b>
          </div>
          <div>
            <span>{t('sound.codec')}</span>
            <b>{codecFact}</b>
          </div>
          <div>
            <span>SHA-256</span>
            <b className="tk-mono">{exists && info?.sha256 ? info.sha256 : t('sound.notAvailable')}</b>
          </div>
          <div>
            <span>{t('sound.modified')}</span>
            <b>{exists && info ? formatDate(info.modified) : t('sound.notAvailable')}</b>
          </div>
        </div>

        {action.kind === 'busy' && <div className="tk-snd-msg">{action.label}</div>}
        {action.kind === 'done' && <div className="tk-snd-msg ok">{action.message}</div>}
        {action.kind === 'error' && <div className="tk-snd-msg err">{action.message}</div>}

        {showAudioWarning ? (
          <div className="tk-snd-warning" role="alert">
            <span className="tk-snd-warning-ic"><Icon name="alert" size={20} /></span>
            <span>{audioError}</span>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <Waveform
              bars={decoding ? SKELETON_BARS : ready ? bars : []}
              durationMs={durationMs}
              currentMs={headMs}
              demoStartMs={demoStartMs}
              interactive={ready}
              loading={decoding}
              onSeekStart={onScrubStart}
              onSeekDraft={(ms) => setScrubMs(clamp(ms, 0, durationMs))}
              onSeekCommit={onScrubCommit}
              onDemoDraft={(ms) => setDraftDemoStartMs(clampDemoStart(ms, durationMs))}
              onDemoCommit={commitDemoStart}
            />
            {decoding && (
              <div className="tk-wave-spinner">
                <span className="tk-spin" /> {t('sound.decodingBank', { filename: resolved.filename })}
              </div>
            )}
            {!decoding && !ready && (
              <div className="tk-wave-spinner">
                {exists ? t('sound.selectToPreview') : t('sound.noBankOnDisk')}
              </div>
            )}
          </div>
        )}

        {/* Pick which chart the fumen-offset editor and preview below act on.
            Shares global selection with the Chart tab, so the two stay synced. */}
        <ChartSlotSelect row={row} />

        <div className={`tk-snd-controls${ready || demoStartEditable || fumenOffsetEditable ? '' : ' is-disabled'}`}>
          <div className="tk-field" style={{ margin: 0 }}>
            <label>
              {t('sound.demoStart')}
              <InfoHint label={t('sound.demoStartHintLabel')}>
                {t('sound.demoStartHintBody')}
              </InfoHint>
            </label>
            <div className="tk-nudge tk-nudge-wide">
              <button onClick={() => nudgeStart(-500)} disabled={!demoStartEditable}>−</button>
              <EditableMsInput
                ariaLabel={t('sound.demoStart')}
                valueMs={demoStartMs}
                disabled={!demoStartEditable}
                onCommit={commitDemoStart}
              />
              <button onClick={() => nudgeStart(500)} disabled={!demoStartEditable}>+</button>
            </div>
          </div>
          <button className="tk-btn tk-btn-primary" onClick={onDemo} disabled={!ready}>
            <Icon name="play" /> {t('sound.demo')}
          </button>
          <div className="tk-field" style={{ margin: 0, marginLeft: 20 }}>
            <label>
              {t('sound.fumenOffset')}
              <InfoHint label={t('sound.fumenOffsetHintLabel')}>
                {t('sound.fumenOffsetHintBody')}
              </InfoHint>
            </label>
            <div className="tk-nudge">
              <button onClick={() => nudgeFumenOffset(-10)} disabled={!fumenOffsetEditable}>−</button>
              <EditableMsInput
                ariaLabel={t('sound.fumenOffset')}
                valueMs={fumenOffsetMs}
                disabled={!fumenOffsetEditable}
                onCommit={(ms) => editCurrentFumenOffset(ms)}
              />
              <button onClick={() => nudgeFumenOffset(10)} disabled={!fumenOffsetEditable}>+</button>
            </div>
          </div>
          <ScaleControls />
          <div style={{ flex: 1 }} />
        </div>
      </div>

      {chart.kind === 'ready' ? (
        <div className="tk-canvas">
          <ScoreCanvas
            fumen={chart.loaded.fumen}
            zoom={zoom}
            noteScale={noteScale}
            tool="select"
            preview
            playheadMs={headMs - introDelayMs}
            followPlayhead={ready && playerState.playing}
          />
        </div>
      ) : (
        <div className="tk-snd-stub">
          <Icon name="sound" />
          <span>{t('sound.stub')}</span>
        </div>
      )}

      {removeConfirmOpen && (
        <ConfirmDialog
          danger
          title={t('sound.removeTitle')}
          body={t('sound.removeConfirm', { path: resolved.displayPath })}
          confirmLabel={t('common.remove')}
          onConfirm={() => void onRemove()}
          onCancel={() => setRemoveConfirmOpen(false)}
        />
      )}
    </div>
  );
}
