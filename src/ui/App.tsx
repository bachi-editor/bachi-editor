import { useEffect } from 'react';
import { useAppStore } from '../model/store';
import { danSectionEdited } from '../model/danEdits';
import { useT } from '../i18n';
import { BrowserSupportGate } from './BrowserSupportGate';
import { SettingsDialog } from './SettingsDialog';
import { AboutDialog } from './AboutDialog';
import { TopBar } from './shell/TopBar';
import { StatusBar } from './shell/StatusBar';
import { SongsArea } from './songs/SongsArea';
import { OrderArea } from './order/OrderArea';
import { DaniArea } from './dani/DaniArea';
import { SaveDialog } from './SaveDialog';
import { ExportDialog } from './ExportDialog';
import { AddSongDialog } from './AddSongDialog';
import { DeleteSongDialog } from './DeleteSongDialog';
import { ImportTjaDialog } from './ImportTjaDialog';

export function App() {
  const support = useAppStore((s) => s.support);
  const project = useAppStore((s) => s.project);
  const area = useAppStore((s) => s.ui.area);
  const saveDialogOpen = useAppStore((s) => s.ui.saveDialogOpen);
  const exportDialogOpen = useAppStore((s) => s.ui.exportDialogOpen);
  const addSongOpen = useAppStore((s) => s.ui.addSongOpen);
  const deleteSongId = useAppStore((s) => s.ui.deleteSongId);
  const tjaImportOpen = useAppStore((s) => s.ui.tjaImportOpen);
  const settingsOpen = useAppStore((s) => s.ui.settingsOpen);
  const aboutOpen = useAppStore((s) => s.ui.aboutOpen);
  const init = useAppStore((s) => s.initFromStoredHandle);
  const daniInit = useAppStore((s) => s.daniInitFromStorage);
  const t = useT();

  useEffect(() => {
    init();
    daniInit(); // reopen the last-used dani files (independent of the game project)
  }, [init, daniInit]);

  // Drafts live in memory only until saved, so a reload or tab close would drop
  // them. Every page's dirty state counts here: the game project (Songs / Music
  // Order) and both dani files, which have their own save scopes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useAppStore.getState();
      const dirty =
        s.getEditCount() > 0
        || danSectionEdited(s.dani.normal)
        || danSectionEdited(s.dani.gaiden);
      if (!dirty) return;
      e.preventDefault();
      // Legacy support (Chrome/Edge < 119): a non-empty returnValue is what
      // arms the browser's own prompt. The string itself is never shown.
      e.returnValue = 'unsaved';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // The app owns right-click. A few surfaces open their own menus (Music Order
  // cards, the Sound tab playhead) via their own handlers; everywhere else the
  // native browser menu is simply muted rather than allowed to break out of the
  // UI. Text fields are the one exception — their menu acts on the user's own
  // text (copy/paste/IME suggestions), not on our chrome.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const editable = !!target
        && (/^(input|textarea)$/i.test(target.tagName) || target.isContentEditable);
      if (editable) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Global keyboard: ⌘/Ctrl+S → save dialog, ⌘Z / ⌘⇧Z → undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      const target = e.target as HTMLElement | null;
      const typing = !!target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable);

      // Arrow keys navigate the current single chart selection. Up and down are
      // intentionally equivalent: they toggle between a note and its measure.
      if (
        !typing
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && s.ui.area === 'songs'
        && s.ui.tab === 'chart'
        && !s.chart.selectedNotes
        && (s.chart.selectedNote || s.chart.selectedMeasure)
      ) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          s.navigateChartSelection(e.key === 'ArrowLeft' ? 'left' : 'right');
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          s.navigateChartSelection('toggle');
          return;
        }
      }

      // Delete / Backspace → remove the current chart selection (single or marquee).
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (s.ui.area === 'songs' && s.ui.tab === 'chart' && (s.chart.selectedNote || s.chart.selectedNotes)) {
          e.preventDefault();
          s.eraseSelectedChartNotes();
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const inDani = s.ui.area === 'dani';
      if (k === 's') {
        e.preventDefault();
        // Each page saves only its own files (see model/saveScope.ts): the Dani
        // Dojo targets the selected file; Music Order and Songs target theirs.
        if (inDani) { if (s.dani.sel) s.daniOpenSave(s.dani.sel.section); }
        else if (s.project.kind === 'open') s.openSaveDialog(s.ui.area === 'order' ? 'order' : 'songs');
      } else if (k === 'z') {
        e.preventDefault();
        if (inDani) { if (e.shiftKey) s.daniRedo(); else s.daniUndo(); }
        else if (e.shiftKey) s.redo(); else s.undo();
      } else if (k === 'y') {
        e.preventDefault();
        if (inDani) s.daniRedo(); else s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!support.ok) return <BrowserSupportGate support={support} />;

  if (project.kind === 'opening') {
    return (
      <div className="tk-center">
        <div className="tk-loading"><span className="tk-spin" /> {t('app.opening')}</div>
      </div>
    );
  }

  return (
    <div className="tk-app">
      <TopBar />
      {area === 'dani' ? <DaniArea /> : area === 'songs' ? <SongsArea /> : <OrderArea />}
      <StatusBar />
      {saveDialogOpen && <SaveDialog />}
      {addSongOpen && <AddSongDialog />}
      {deleteSongId !== undefined && <DeleteSongDialog />}
      {tjaImportOpen && <ImportTjaDialog />}
      {settingsOpen && <SettingsDialog />}
      {/* Export is launched from Settings, so it renders last to stack on top. */}
      {exportDialogOpen && <ExportDialog />}
      {/* About doubles as the first-run welcome, so it sits above everything. */}
      {aboutOpen && <AboutDialog />}
    </div>
  );
}
