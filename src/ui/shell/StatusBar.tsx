import { useMemo } from 'react';
import { useAppStore } from '../../model/store';
import { useT } from '../../i18n';
import { verifyEncoderSelfConsistent, type Fumen } from '../../codec';
import { fumenFilename } from '../../fs/fumens';
import { resolveSoundFile } from '../../fs/sound';
import { DaniStatusBar } from '../dani/DaniStatusBar';
import { OrderStatusBar } from '../order/OrderStatusBar';
import { StatusPath } from './StatusPath';

function countNotes(f: Fumen): number {
  let n = 0;
  for (const m of f.measures) for (const b of m.branches) n += b.notes.length;
  return n;
}

function formatBpm(bpm: number): string {
  if (Number.isInteger(bpm)) return String(bpm);
  return bpm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function StatusBar() {
  const area = useAppStore((s) => s.ui.area);
  const tab = useAppStore((s) => s.ui.tab);
  const fumen = useAppStore((s) => s.fumen);
  const songId = useAppStore((s) => s.selection.songId);
  const difficulty = useAppStore((s) => s.selection.difficulty);
  const player = useAppStore((s) => s.selection.player);
  const project = useAppStore((s) => s.project);
  const t = useT();
  const ready = fumen.kind === 'ready' ? fumen.loaded.fumen : undefined;

  const bpm = ready && ready.measures.length > 0 ? formatBpm(ready.measures[0].bpm) : '—';
  const notes = ready ? countNotes(ready) : 0;
  const measures = ready ? ready.measures.length : 0;
  const codecOk = useMemo(() => {
    if (!ready) return true;
    try {
      return verifyEncoderSelfConsistent(ready).ok;
    } catch {
      return false;
    }
  }, [ready]);

  // Name the exact file(s) the current tab reads/writes so the status path
  // tracks the difficulty/player selectors and the resolved sound bank. Each
  // entry is a full project-relative path (files may live in different folders).
  const songRow = project.kind === 'open' && songId ? project.project.songs.byId.get(songId) : undefined;
  const paths = useMemo<string[]>(() => {
    const musicinfoPath = 'Data/x64/datatable/musicinfo.bin';
    const fumenPath = songId ? `Data/x64/fumen/${songId}/${fumenFilename(songId, difficulty, player)}` : 'Data/x64/fumen/';
    const soundPath = songRow ? `Data/x64/sound/${resolveSoundFile(songRow.info).filename}` : 'Data/x64/sound/';
    // Chart edits also update note counts and other chart-derived musicinfo fields.
    if (tab === 'chart') return [musicinfoPath, fumenPath];
    // The Sound tab writes demo-start to the sound bank *and* the offset to the
    // selected chart, so it names both files.
    if (tab === 'sound') return [soundPath, fumenPath];
    // Metadata edits fan out across both the info table and the localized strings.
    return [musicinfoPath, 'Data/x64/datatable/wordlist.bin'];
  }, [tab, songId, difficulty, player, songRow]);

  // The Dani Dojo area has its own file-oriented status line.
  if (area === 'dani') return <DaniStatusBar />;
  // With no game project, the shell remains available but there are no file
  // paths or codec claims to display yet.
  if (project.kind !== 'open') {
    return (
      <div className="tk-status">
        <div className="grp"><span>{t('statusbar.noProject')}</span></div>
      </div>
    );
  }
  // The Music Order area shows genre/entry counts instead of chart status.
  if (area === 'order') return <OrderStatusBar />;

  return (
    <div className="tk-status">
      <div className="grp"><span>♩</span><b>{bpm}</b> BPM</div>
      <div className="grp"><span>{t('statusbar.notes')}</span><b>{notes}</b></div>
      <div className="grp"><span>{t('statusbar.measure')}</span><b>{measures ? `${String(measures).padStart(2, '0')} / ${measures}` : '— / —'}</b></div>
      <div className="grp">
        <span className={codecOk ? 'ok' : 'err'}>{codecOk ? '✓' : '✗'}</span>
        <span className={codecOk ? 'ok' : 'err'}>{codecOk ? t('statusbar.codecOk') : t('statusbar.codecFailed')}</span>
      </div>
      <div className="grp"><span>AES-256-CBC · gzip</span></div>
      <StatusPath paths={paths} />
    </div>
  );
}
