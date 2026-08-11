import { useEffect, useState } from 'react';

/**
 * Returns `false` on the first painted frame and `true` a couple of frames
 * later. Switching to the Songs / Music Order pages mounts a view that renders
 * 1000+ rows or cards in one synchronous pass (~0.3s). Gating that render on
 * this flag lets the page paint a lightweight skeleton immediately — so the tab
 * switch feels instant — then swap in the real list once the browser has had a
 * chance to show the placeholder.
 *
 * The double requestAnimationFrame is deliberate: the first callback fires
 * before the skeleton's paint, the second after it, guaranteeing at least one
 * placeholder frame reaches the screen before the heavy work runs.
 */
export function useDeferredReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return ready;
}
