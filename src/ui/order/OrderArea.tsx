// Music Order area — library-level Kanban of genre folders. Placements can be
// dragged to reorder within a folder or moved across folders without changing
// the song's canonical metadata genre. Transient hover/selection/drag state is
// deliberately isolated below the board root: this surface contains 1000+
// cards, so a one-card interaction must never invalidate the entire tree.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useAppStore } from '../../model/store';
import {
  preferredTitle,
  songStars,
  type Locale,
} from '../../model/songlist';
import { orderScopeDirty } from '../../model/saveScope';
import { GENRES, genreFor, genreMessageKey } from '../../model/genres';
import { useT } from '../../i18n';
import { ContextMenu } from '../shell/ContextMenu';
import { Icon } from '../shell/Icon';
import { PageHeader } from '../shell/PageHeader';
import { OrderBoardSkeleton } from '../shell/Skeleton';
import { useDeferredReady } from '../shell/useDeferredReady';
import { MarqueeText } from '../shell/MarqueeText';
import { SongMetadataLine } from '../SongMetadataLine';
import { createOrderSelectionStore, type OrderSelectionStore } from './orderSelection';
import { OrderSongPicker } from './OrderSongPicker';
import {
  buildOrderFolders,
  createPlacementKeyFor,
  type OrderFolder,
  type OrderPlacement,
  type PlacementKey,
} from './orderView';

interface DropAt {
  genreNo: number;
  index: number;
}

interface DropMarker {
  left: number;
  top: number;
  width: number;
}

interface DragSource extends DropAt {
  songId: string;
}

const GENRE_NOS = GENRES.map((genre) => genre.no);

function usePlacementSelected(store: OrderSelectionStore, key: PlacementKey): boolean {
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key, store]);
  const snapshot = useCallback(() => store.isSelected(key), [key, store]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

const OrderCard = memo(function OrderCard({
  placement,
  compact,
  locale,
  selection,
  canonicalGenreTitle,
  warning,
  onBeginDrag,
  onEndDrag,
}: {
  placement: OrderPlacement;
  compact: boolean;
  locale: Locale;
  selection: OrderSelectionStore;
  canonicalGenreTitle: string;
  warning: boolean;
  onBeginDrag: (placement: OrderPlacement) => void;
  onEndDrag: () => void;
}) {
  const selected = usePlacementSelected(selection, placement.key);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const suppressClickUntil = useRef(0);
  const active = !dragging && (hovered || selected);
  const { row } = placement;

  const onDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    setDragging(true);
    onBeginDrag(placement);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for the drag to start.
    event.dataTransfer.setData('text/plain', row.id);
  };

  const onDragEnd = () => {
    setDragging(false);
    suppressClickUntil.current = Date.now() + 100;
    onEndDrag();
  };

  const classes = ['tk-ocard'];
  if (compact) classes.push('compact');
  if (dragging) classes.push('drag');
  if (selected) classes.push('focus');
  if (warning) classes.push('warning');

  return (
    <div
      className={classes.join(' ')}
      draggable
      data-order-card=""
      data-song-id={row.id}
      data-genre-no={placement.genreNo}
      data-order-index={placement.index}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (Date.now() < suppressClickUntil.current) return;
        selection.select(placement.key);
      }}
    >
      <span className="tk-ohandle">
        <Icon name="grip" />
      </span>
      <span className="tk-ocard-idx">{placement.index + 1}</span>
      {/* The song's canonical genre colour may differ from its placement. */}
      <span
        className="tk-genre"
        style={{ background: genreFor(row.genreNo).color }}
        title={canonicalGenreTitle}
      />
      <div className="tk-ocard-main">
        <div className="tk-ocard-title">
          <MarqueeText text={preferredTitle(row, locale)} active={active} />
        </div>
        {/* The folder is this placement's music_order genre; the card keeps the
            canonical musicinfo genre visible when they disagree. */}
        <SongMetadataLine
          songId={row.id}
          songNo={row.uniqueId}
          genreNo={row.genreNo}
          stars={songStars(row)}
          active={active}
        />
      </div>
    </div>
  );
});

const OrderCardList = memo(function OrderCardList({
  folder,
  compact,
  locale,
  selection,
  onBeginDrag,
  onEndDrag,
}: {
  folder: OrderFolder;
  compact: boolean;
  locale: Locale;
  selection: OrderSelectionStore;
  onBeginDrag: (placement: OrderPlacement) => void;
  onEndDrag: () => void;
}) {
  const t = useT();
  return (
    <div className="tk-folder-list" data-order-list="">
      {folder.placements.map((placement) => (
        <OrderCard
          key={placement.key}
          placement={placement}
          compact={compact}
          locale={locale}
          selection={selection}
          canonicalGenreTitle={t(genreMessageKey(placement.row.genreNo))}
          warning={folder.validation.affectedPlacementKeys.has(placement.key)}
          onBeginDrag={onBeginDrag}
          onEndDrag={onEndDrag}
        />
      ))}
    </div>
  );
});

const OrderColumn = memo(function OrderColumn({
  folder,
  compact,
  locale,
  selection,
  onToggleCompact,
  onAddSong,
  onBeginDrag,
  onEndDrag,
}: {
  folder: OrderFolder;
  compact: boolean;
  locale: Locale;
  selection: OrderSelectionStore;
  onToggleCompact: (genreNo: number) => void;
  onAddSong: (genreNo: number) => void;
  onBeginDrag: (placement: OrderPlacement) => void;
  onEndDrag: () => void;
}) {
  const t = useT();
  const genre = genreFor(folder.genreNo);
  const issueMessages = folder.validation.issues.map((issue) => {
    const title = preferredTitle(issue.row, locale);
    const song = title === issue.songId ? issue.songId : `${title} · ${issue.songId}`;
    return {
      key: `${issue.kind}:${issue.songId}`,
      message: t('order.issue.duplicateSong', {
        song,
        indices: issue.indices.join(', '),
      }),
    };
  });
  return (
    <div
      className="tk-folder"
      data-order-folder=""
      data-genre-no={folder.genreNo}
      data-order-count={folder.placements.length}
    >
      <div className="tk-folder-head">
        <span className="tk-folder-dot" style={{ background: genre.color }} />
        <span className="nm">{t(genreMessageKey(folder.genreNo))}</span>
        <span className="tk-folder-summary">
          {issueMessages.length > 0 && (
            <span
              className="tk-hint tk-folder-warning"
              tabIndex={0}
              role="note"
              aria-label={issueMessages.map((issue) => issue.message).join(' ')}
            >
              <Icon name="alert" size={15} className="tk-hint-ic" />
              <span className="tk-hint-pop" role="tooltip">
                {issueMessages.map((issue) => (
                  <span className="tk-folder-warning-issue" key={issue.key}>
                    {issue.message}
                  </span>
                ))}
              </span>
            </span>
          )}
          <span className="ct">{folder.placements.length}</span>
        </span>
        <button
          type="button"
          className={`tk-folder-density${compact ? ' on' : ''}`}
          title={compact ? t('order.expand') : t('order.compact')}
          aria-label={compact ? t('order.expand') : t('order.compact')}
          aria-pressed={compact}
          onClick={() => onToggleCompact(folder.genreNo)}
        >
          <Icon name={compact ? 'expand' : 'compress'} size={15} />
        </button>
        <button
          type="button"
          className="tk-folder-density tk-folder-add"
          title={t('order.addSong')}
          aria-label={t('order.addSong')}
          onClick={() => onAddSong(folder.genreNo)}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
      <OrderCardList
        folder={folder}
        compact={compact}
        locale={locale}
        selection={selection}
        onBeginDrag={onBeginDrag}
        onEndDrag={onEndDrag}
      />
    </div>
  );
});

interface CardMenu {
  songId: string;
  genreNo: number;
  index: number;
  /** Placement count in the folder — used to disable end-of-list moves. */
  count: number;
  /** Viewport coordinates of the right-click that opened the menu. */
  x: number;
  y: number;
}

// Right-click actions for a placement. Positioned at the cursor (fixed), clamped
// into the viewport, and dismissed on outside-click / Esc / scroll / resize. The
// moves are expressed as reorderSong drops so they share the board's exact
// (folder, slot) semantics; "move down" targets index+2 because the drop slot is
// counted before the card is lifted out.
const OrderCardMenu = memo(function OrderCardMenu({
  menu,
  onClose,
}: {
  menu: CardMenu;
  onClose: () => void;
}) {
  const t = useT();
  const reorderSong = useAppStore((s) => s.reorderSong);
  const removeSongFromOrder = useAppStore((s) => s.removeSongFromOrder);
  const revealSongInEditor = useAppStore((s) => s.revealSongInEditor);

  const { songId, genreNo, index, count } = menu;
  const atTop = index === 0;
  const atBottom = index === count - 1;

  return (
    <ContextMenu anchor={menu} onClose={onClose} minWidth={194}>
      {(close) => {
        const act = (fn: () => void) => {
          fn();
          close();
        };
        return (
          <>
            <button
              className="tk-menu-item"
              role="menuitem"
              disabled={atTop}
              onClick={() => act(() => reorderSong(songId, genreNo, index, genreNo, 0))}
            >
              <span className="ic"><Icon name="arrow-top" size={15} /></span>
              {t('order.menu.moveTop')}
            </button>
            <button
              className="tk-menu-item"
              role="menuitem"
              disabled={atTop}
              onClick={() => act(() => reorderSong(songId, genreNo, index, genreNo, index - 1))}
            >
              <span className="ic"><Icon name="arrow-up" size={15} /></span>
              {t('order.menu.moveUp')}
            </button>
            <button
              className="tk-menu-item"
              role="menuitem"
              disabled={atBottom}
              onClick={() => act(() => reorderSong(songId, genreNo, index, genreNo, index + 2))}
            >
              <span className="ic"><Icon name="arrow-down" size={15} /></span>
              {t('order.menu.moveDown')}
            </button>
            <button
              className="tk-menu-item"
              role="menuitem"
              disabled={atBottom}
              onClick={() => act(() => reorderSong(songId, genreNo, index, genreNo, count))}
            >
              <span className="ic"><Icon name="arrow-bottom" size={15} /></span>
              {t('order.menu.moveBottom')}
            </button>
            <div className="tk-menu-sep" />
            <button
              className="tk-menu-item"
              role="menuitem"
              onClick={() => act(() => revealSongInEditor(songId))}
            >
              <span className="ic"><Icon name="note" size={15} /></span>
              {t('order.menu.showInEditor')}
            </button>
            <div className="tk-menu-sep" />
            <button
              className="tk-menu-item danger"
              role="menuitem"
              onClick={() => act(() => removeSongFromOrder(songId, genreNo, index))}
            >
              <span className="ic"><Icon name="trash" size={15} /></span>
              {t('order.menu.remove')}
            </button>
          </>
        );
      }}
    </ContextMenu>
  );
});

export function OrderArea() {
  const baseline = useAppStore((state) => (
    state.project.kind === 'open' ? state.project.project.baseline : undefined
  ));
  const musicinfo = useAppStore((state) => (
    state.project.kind === 'open' ? state.project.project.datatables.musicinfo : undefined
  ));
  const musicOrder = useAppStore((state) => (
    state.project.kind === 'open' ? state.project.project.datatables.musicOrder : undefined
  ));
  const songsById = useAppStore((state) => (
    state.project.kind === 'open' ? state.project.project.songs.byId : undefined
  ));
  const locale = useAppStore((state) => state.ui.locale);
  const reorderSong = useAppStore((state) => state.reorderSong);
  const openSaveDialog = useAppStore((state) => state.openSaveDialog);
  const ready = useDeferredReady();
  const t = useT();

  const [compact, setCompact] = useState<Set<number>>(new Set());
  const [pickerGenre, setPickerGenre] = useState<number | null>(null);
  const [cardMenu, setCardMenu] = useState<CardMenu | null>(null);
  const addSongToOrder = useAppStore((state) => state.addSongToOrder);
  const keyFor = useMemo(createPlacementKeyFor, []);
  const selection = useMemo(createOrderSelectionStore, []);
  const previousFolders = useRef<OrderFolder[]>([]);
  const dragSource = useRef<DragSource | null>(null);
  const dropTarget = useRef<DropAt | null>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const markerFrame = useRef(0);
  const pendingMarker = useRef<DropMarker | null>(null);

  const folders = useMemo(() => {
    if (!musicOrder || !songsById) return [];
    return buildOrderFolders(
      musicOrder.items,
      songsById,
      GENRE_NOS,
      keyFor,
      previousFolders.current,
    );
  }, [keyFor, musicOrder, songsById]);

  useEffect(() => {
    previousFolders.current = folders;
  }, [folders]);

  const orderDirty = useMemo(() => {
    if (!baseline || !musicinfo || !musicOrder) return false;
    return orderScopeDirty(baseline, { ...baseline, musicinfo, musicOrder });
  }, [baseline, musicinfo, musicOrder]);

  const toggleCompact = useCallback((genreNo: number) => {
    setCompact((previous) => {
      const next = new Set(previous);
      if (next.has(genreNo)) next.delete(genreNo);
      else next.add(genreNo);
      return next;
    });
  }, []);

  const openPicker = useCallback((genreNo: number) => setPickerGenre(genreNo), []);
  const closeMenu = useCallback(() => setCardMenu(null), []);

  // Right-click on a card opens its actions menu. Delegated at the board (like the
  // drag handlers) so a menu open doesn't add a listener to every one of the 1000+
  // cards; the addressed placement is read from the card's data attributes.
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-order-card]');
    if (!card) return;
    const folder = card.closest<HTMLElement>('[data-order-folder]');
    if (!folder) return;
    const songId = card.dataset.songId;
    const genreNo = Number(card.dataset.genreNo);
    const index = Number(card.dataset.orderIndex);
    const count = Number(folder.dataset.orderCount);
    if (!songId || !Number.isFinite(genreNo) || !Number.isFinite(index) || !Number.isFinite(count)) return;
    event.preventDefault();
    setCardMenu({ songId, genreNo, index, count, x: event.clientX, y: event.clientY });
  }, []);

  const hideDropMarker = useCallback(() => {
    dropTarget.current = null;
    pendingMarker.current = null;
    if (markerFrame.current) cancelAnimationFrame(markerFrame.current);
    markerFrame.current = 0;
    if (markerRef.current) markerRef.current.style.opacity = '0';
  }, []);

  useEffect(() => hideDropMarker, [hideDropMarker]);

  const queueDropMarker = useCallback((target: DropAt, marker: DropMarker) => {
    const currentTarget = dropTarget.current;
    const currentMarker = pendingMarker.current;
    if (
      currentTarget?.genreNo === target.genreNo
      && currentTarget.index === target.index
      && currentMarker?.left === marker.left
      && currentMarker.top === marker.top
      && currentMarker.width === marker.width
    ) return;
    dropTarget.current = target;
    pendingMarker.current = marker;
    if (markerFrame.current) return;
    markerFrame.current = requestAnimationFrame(() => {
      markerFrame.current = 0;
      const next = pendingMarker.current;
      const element = markerRef.current;
      if (!next || !element) return;
      element.style.width = `${next.width}px`;
      element.style.transform = `translate3d(${next.left}px, ${next.top}px, 0)`;
      element.style.opacity = '1';
    });
  }, []);

  const beginDrag = useCallback((placement: OrderPlacement) => {
    dragSource.current = {
      songId: placement.row.id,
      genreNo: placement.genreNo,
      index: placement.index,
    };
  }, []);

  const endDrag = useCallback(() => {
    dragSource.current = null;
    hideDropMarker();
  }, [hideDropMarker]);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragSource.current) return;
    const element = event.target as HTMLElement;
    const folder = element.closest<HTMLElement>('[data-order-folder]');
    const board = event.currentTarget;
    if (!folder || !board.contains(folder)) return;
    const genreNo = Number(folder.dataset.genreNo);
    if (!Number.isFinite(genreNo)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const boardRect = board.getBoundingClientRect();
    const card = element.closest<HTMLElement>('[data-order-card]');
    let index: number;
    let slotY: number;
    let left: number;
    let width: number;
    if (card && folder.contains(card)) {
      const cardRect = card.getBoundingClientRect();
      const after = event.clientY > cardRect.top + cardRect.height / 2;
      index = Number(card.dataset.orderIndex) + (after ? 1 : 0);
      slotY = after ? cardRect.bottom : cardRect.top;
      left = cardRect.left + 4;
      width = Math.max(0, cardRect.width - 8);
    } else {
      const list = folder.querySelector<HTMLElement>('[data-order-list]');
      if (!list) return;
      const listRect = list.getBoundingClientRect();
      const overList = element.closest<HTMLElement>('[data-order-list]') === list;
      const cards = list.querySelectorAll<HTMLElement>('[data-order-card]');
      if (overList && cards.length > 0) {
        // The flex gap belongs to the list rather than either adjacent card.
        // Binary-search card midpoints so those narrow gaps still resolve to the
        // nearest insertion slot without installing a handler on every wrapper.
        let low = 0;
        let high = cards.length;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const rect = cards[mid].getBoundingClientRect();
          if (event.clientY < rect.top + rect.height / 2) high = mid;
          else low = mid + 1;
        }
        index = low;
        const anchor = cards[Math.min(low, cards.length - 1)].getBoundingClientRect();
        slotY = low < cards.length ? anchor.top : anchor.bottom;
        left = anchor.left + 4;
        width = Math.max(0, anchor.width - 8);
      } else {
        // As before, dropping on the folder header/empty chrome means append.
        index = Number(folder.dataset.orderCount);
        slotY = listRect.bottom - 7;
        left = listRect.left + 11;
        width = Math.max(0, listRect.width - 22);
      }
    }
    if (!Number.isFinite(index)) return;
    queueDropMarker(
      { genreNo, index },
      {
        left: left - boardRect.left + board.scrollLeft,
        top: slotY - boardRect.top + board.scrollTop - 2.5,
        width,
      },
    );
  }, [queueDropMarker]);

  const onDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const source = dragSource.current;
    const target = dropTarget.current;
    if (!source || !target) return;
    event.preventDefault();
    hideDropMarker();
    dragSource.current = null;
    reorderSong(source.songId, source.genreNo, source.index, target.genreNo, target.index);
  }, [hideDropMarker, reorderSong]);

  const hasProject = !!baseline && !!musicinfo && !!musicOrder && !!songsById;

  return (
    <div className="tk-order">
      <PageHeader
        title={t('order.title')}
        hint={t('order.dragHint')}
        actions={[{
          key: 'order',
          label: t('common.save'),
          dirty: orderDirty,
          onSave: () => openSaveDialog('order'),
          kbd: true,
        }]}
      />
      {!hasProject ? (
        <div className="tk-order-empty">{t('order.emptyNoProject')}</div>
      ) : ready ? (
        <div
          className="tk-order-board"
          onDragOver={onDragOver}
          onDrop={onDrop}
          onContextMenu={onContextMenu}
        >
          {folders.map((folder) => (
            <OrderColumn
              key={folder.genreNo}
              folder={folder}
              compact={compact.has(folder.genreNo)}
              locale={locale}
              selection={selection}
              onToggleCompact={toggleCompact}
              onAddSong={openPicker}
              onBeginDrag={beginDrag}
              onEndDrag={endDrag}
            />
          ))}
          <div ref={markerRef} className="tk-drop-overlay" aria-hidden />
        </div>
      ) : <OrderBoardSkeleton />}
      {cardMenu && <OrderCardMenu menu={cardMenu} onClose={closeMenu} />}
      {pickerGenre !== null && (
        <OrderSongPicker
          genreNo={pickerGenre}
          onPick={(uniqueId) => {
            addSongToOrder(pickerGenre, uniqueId);
            setPickerGenre(null);
          }}
          onClose={() => setPickerGenre(null)}
        />
      )}
    </div>
  );
}
