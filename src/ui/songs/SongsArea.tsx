import { useAppStore } from '../../model/store';
import { useT } from '../../i18n';
import { SongList } from '../SongList';
import { PageHeader } from '../shell/PageHeader';
import { EditorTabs } from './EditorTabs';
import { SongHeader } from './SongHeader';
import { MetadataTab } from './MetadataTab';
import { SoundTab } from './SoundTab';
import { ChartTab } from './chart/ChartTab';

export function SongsArea() {
  const project = useAppStore((s) => s.project);
  const songId = useAppStore((s) => s.selection.songId);
  const tab = useAppStore((s) => s.ui.tab);
  // isSongsDirty reads the draft maps, so subscribe to project to re-render on edits.
  const dirty = useAppStore((s) => (s.project.kind === 'open' ? s.isSongsDirty() : false));
  const openSaveDialog = useAppStore((s) => s.openSaveDialog);
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;
  const row = open && songId ? open.songs.byId.get(songId) : undefined;

  return (
    <>
      <PageHeader
        title={t('songs.editorTitle')}
        hint={t('songs.pageHint')}
        actions={[{ key: 'songs', label: t('common.save'), dirty, onSave: () => openSaveDialog('songs'), kbd: true }]}
      />
      <div className="tk-body">
        <SongList />
        <div className="tk-editor">
          <EditorTabs />
          {!row ? (
            <div className="tk-placeholder">{t('songsarea.placeholder')}</div>
          ) : tab === 'chart' ? (
            <ChartTab row={row} />
          ) : (
            <>
              <SongHeader row={row} />
              {tab === 'metadata' && <MetadataTab row={row} />}
              {tab === 'sound' && <SoundTab row={row} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
