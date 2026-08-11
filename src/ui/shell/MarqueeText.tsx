import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Blank space (px) kept between the two chasing title copies while scrolling.
const GAP = 48;
// Scroll speed in px/second — deliberately gentle so long titles stay readable.
const SPEED = 45;
// How long the title holds still at the top of each cycle, in ms.
const PAUSE_MS = 1600;

// Read once: OS-level reduced-motion preference rarely toggles mid-session, and
// this component can render hundreds of times, so we avoid a listener per row.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A board can mount 1000+ titles. One observer can watch all of their boxes;
// allocating an observer per title creates needless native objects and fans out
// resize delivery through hundreds of separate callbacks.
const resizeCallbacks = new WeakMap<Element, () => void>();
let sharedResizeObserver: ResizeObserver | undefined;

function observeResize(element: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  sharedResizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) resizeCallbacks.get(entry.target)?.();
  });
  resizeCallbacks.set(element, callback);
  sharedResizeObserver.observe(element);
  return () => {
    resizeCallbacks.delete(element);
    sharedResizeObserver?.unobserve(element);
  };
}

export interface MarqueeTextProps {
  /** The full text to display. */
  text: string;
  /**
   * When true (row selected / card highlighted) an overflowing title scrolls;
   * otherwise it is trailing-faded to signal there is more text.
   */
  active: boolean;
}

/**
 * A fixed-width title cell. When the text fits it renders plainly. When it is
 * longer than its column it fades out at the trailing edge while idle, and —
 * once `active` — gently scrolls right-to-left on a seamless loop: two copies of
 * the title chase each other so that when the second reaches the first's slot the
 * frame is identical, letting the transform reset invisibly before the next pass.
 */
export function MarqueeText({ text, active }: MarqueeTextProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);

  // Track whether a single copy of the title is wider than its column.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const seg = segRef.current;
    if (!box || !seg) return;
    const measure = () => setOverflow(seg.getBoundingClientRect().width > box.clientWidth + 0.5);
    measure();
    return observeResize(box, measure);
  }, [text]);

  const scrolling = active && overflow && !reducedMotion;

  // Drive the loop with the Web Animations API: dynamic keyframe offsets let us
  // hold a constant scroll speed and a fixed pause no matter how long the title
  // is (a plain CSS animation would tie both to the fixed keyframe percentages).
  useEffect(() => {
    const track = trackRef.current;
    const seg = segRef.current;
    if (!track || !seg || !scrolling) return;
    const shift = seg.getBoundingClientRect().width + GAP;
    const moveMs = (shift / SPEED) * 1000;
    const totalMs = moveMs + PAUSE_MS;
    const anim = track.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: PAUSE_MS / totalMs },
        { transform: `translateX(-${shift}px)`, offset: 1 },
      ],
      { duration: totalMs, iterations: Infinity, easing: 'linear' },
    );
    return () => anim.cancel();
  }, [scrolling, text]);

  return (
    <div
      ref={boxRef}
      className="tk-marquee"
      data-clip={overflow && !scrolling ? '' : undefined}
      title={overflow ? text : undefined}
    >
      <div ref={trackRef} className="tk-marquee-track">
        <span ref={segRef} className="tk-marquee-seg">
          {text}
        </span>
        {scrolling && (
          <>
            <span className="tk-marquee-gap" aria-hidden="true" style={{ width: GAP }} />
            <span className="tk-marquee-seg" aria-hidden="true">
              {text}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
