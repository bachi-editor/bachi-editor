import { describe, expect, it } from 'vitest';
import { scrollPositionForPlayhead, type PlayheadFollowInput } from '../../src/ui/fumen/scoreFollow';

const BASE: PlayheadFollowInput = {
  viewportLeft: 0,
  viewportTop: 0,
  viewportWidth: 1000,
  viewportHeight: 400,
  targetX: 500,
  targetTop: 100,
  targetBottom: 172,
  scrollLeft: 0,
  scrollTop: 0,
  maxScrollLeft: 2000,
  maxScrollTop: 2000,
};

describe('scrollPositionForPlayhead', () => {
  it('does nothing while the playhead row is within the safe viewport', () => {
    expect(scrollPositionForPlayhead(BASE)).toBeUndefined();
  });

  it('follows the playhead horizontally and vertically', () => {
    expect(scrollPositionForPlayhead({
      ...BASE,
      targetX: 950,
      targetTop: 380,
      targetBottom: 452,
      scrollLeft: 100,
      scrollTop: 200,
    })).toEqual({ left: 146, top: 300 });
  });

  it('aligns the top when a row is taller than the safe viewport', () => {
    expect(scrollPositionForPlayhead({
      ...BASE,
      viewportHeight: 100,
      targetTop: 30,
      targetBottom: 120,
      scrollTop: 200,
    })).toEqual({ left: 0, top: 214 });
  });

  it('does not request no-op scrolling past the content bounds', () => {
    expect(scrollPositionForPlayhead({ ...BASE, targetX: 10 })).toBeUndefined();
    expect(scrollPositionForPlayhead({
      ...BASE,
      targetX: 990,
      scrollLeft: BASE.maxScrollLeft,
    })).toBeUndefined();
  });

  it('keeps safe margins ordered in a collapsed viewport', () => {
    expect(scrollPositionForPlayhead({
      ...BASE,
      viewportWidth: 30,
      viewportHeight: 20,
      targetX: 15,
      targetTop: 10,
      targetBottom: 10,
    })).toBeUndefined();
  });
});
