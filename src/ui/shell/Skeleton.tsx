// Lightweight placeholders shown for one frame while a heavy view (the song
// list / order board) renders its 1000+ real rows. See useDeferredReady.

import { Icon } from './Icon';

/** A column of shimmering song-row placeholders, sized like real .tk-song rows. */
export function SongListSkeleton({ rows = 14 }: { rows?: number }) {
  return (
    <div className="tk-skel-list" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="tk-skel-song" key={i}>
          <span className="tk-skel-dot" />
          <div className="tk-skel-lines">
            <span className="tk-skel-bar w1" />
            <span className="tk-skel-bar w2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder genre board. Reuses the real .tk-folder / .tk-ocard markup so the
 * columns and cards are pixel-identical to the loaded board (the `.tk-skelboard`
 * wrapper only swaps text for shimmer bars and neutralises interactivity), and
 * fills 8 genres × 10 cards so it reads as a full board rather than a stub.
 */
export function OrderBoardSkeleton({ columns = 8, cards = 10 }: { columns?: number; cards?: number }) {
  return (
    <div className="tk-order-board tk-skelboard" aria-hidden>
      {Array.from({ length: columns }, (_, c) => (
        <div className="tk-folder" key={c}>
          <div className="tk-folder-head">
            <span className="tk-folder-dot tk-skel-fill" />
            <span className="nm"><span className="tk-skel-bar" style={{ width: 84 }} /></span>
            <span className="tk-folder-summary">
              <span className="ct tk-skel-fill" />
            </span>
            <span className="tk-folder-density tk-skel-fill" />
          </div>
          <div className="tk-folder-list">
            {Array.from({ length: cards }, (_, i) => (
              <div className="tk-ocard" key={i}>
                <span className="tk-ohandle"><Icon name="grip" /></span>
                <span className="tk-ocard-idx" />
                <span className="tk-genre tk-skel-fill" />
                <div className="tk-ocard-main">
                  <div className="tk-ocard-title"><span className="tk-skel-bar" style={{ width: '72%' }} /></div>
                  <span className="tk-song-meta split"><span className="tk-skel-bar" style={{ width: '48%' }} /></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
