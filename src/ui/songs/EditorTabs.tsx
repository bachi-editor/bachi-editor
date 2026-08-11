import { useAppStore, EditorTab } from '../../model/store';
import { MessageKey, useT } from '../../i18n';
import { Icon, IconName } from '../shell/Icon';

const TABS: { value: EditorTab; labelKey: MessageKey; icon: IconName }[] = [
  { value: 'metadata', labelKey: 'tabs.metadata', icon: 'meta' },
  { value: 'chart', labelKey: 'tabs.chart', icon: 'note' },
  { value: 'sound', labelKey: 'tabs.sound', icon: 'sound' },
];

export function EditorTabs() {
  const tab = useAppStore((s) => s.ui.tab);
  const songId = useAppStore((s) => s.selection.songId);
  const songSlots = useAppStore((s) => s.songSlots);
  const setTab = useAppStore((s) => s.setTab);
  const openTjaImport = useAppStore((s) => s.openTjaImport);
  const openDeleteSong = useAppStore((s) => s.openDeleteSong);
  // Delete acts on the whole song, not the open tab, so it lives with the other
  // song-level action here rather than being repeated in every tab's header.
  const uniqueId = useAppStore((s) => (
    s.project.kind === 'open' && s.selection.songId
      ? s.project.project.songs.byId.get(s.selection.songId)?.uniqueId
      : undefined
  ));
  const t = useT();
  return (
    <div className="tk-tabs">
      {TABS.map((tb) => (
        <button
          key={tb.value}
          className={'tk-tab' + (tab === tb.value ? ' on' : '')}
          onClick={() => setTab(tb.value)}
        >
          <span className="tk-tab-ic"><Icon name={tb.icon} /></span>
          {t(tb.labelKey)}
        </button>
      ))}
      <div className="tk-spacer" />
      <div className="tk-tabs-actions">
        <button
          className="tk-btn tk-btn-sm tk-tabs-action"
          onClick={openTjaImport}
          disabled={!songId || songSlots === undefined}
          title={t('importtja.buttonHint')}
          aria-label={t('importtja.buttonHint')}
        >
          <Icon name="import" /> {t('importtja.button')}
        </button>
        <button
          className="tk-btn tk-btn-sm tk-btn-danger tk-tabs-action"
          onClick={() => uniqueId !== undefined && openDeleteSong(uniqueId)}
          disabled={uniqueId === undefined}
          title={t('songheader.deleteTitle')}
          aria-label={t('songheader.deleteTitle')}
        >
          <Icon name="eraser" /> {t('deletesong.title')}
        </button>
      </div>
    </div>
  );
}
