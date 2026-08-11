export interface PlayheadFollowInput {
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  targetX: number;
  targetTop: number;
  targetBottom: number;
  scrollLeft: number;
  scrollTop: number;
  maxScrollLeft: number;
  maxScrollTop: number;
}

export interface ScrollPosition {
  left: number;
  top: number;
}

const SCROLL_EPSILON_PX = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function followMargin(size: number, ratio: number, min: number, max: number): number {
  const available = Math.max(0, size);
  return Math.min(available / 2, Math.min(max, Math.max(min, available * ratio)));
}

/** Return the bounded scroll position needed to keep a playhead row visible. */
export function scrollPositionForPlayhead(input: PlayheadFollowInput): ScrollPosition | undefined {
  const viewportWidth = Math.max(0, input.viewportWidth);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const xMargin = followMargin(viewportWidth, 0.2, 24, 96);
  const yMargin = followMargin(viewportHeight, 0.16, 16, 48);
  const visibleLeft = input.viewportLeft + xMargin;
  const visibleRight = input.viewportLeft + viewportWidth - xMargin;
  const visibleTop = input.viewportTop + yMargin;
  const visibleBottom = input.viewportTop + viewportHeight - yMargin;

  let deltaLeft = 0;
  let deltaTop = 0;
  if (input.targetX < visibleLeft) deltaLeft = input.targetX - visibleLeft;
  else if (input.targetX > visibleRight) deltaLeft = input.targetX - visibleRight;

  if (input.targetTop < visibleTop) {
    deltaTop = input.targetTop - visibleTop;
  } else if (input.targetBottom > visibleBottom) {
    const targetFits = input.targetBottom - input.targetTop <= visibleBottom - visibleTop;
    deltaTop = targetFits ? input.targetBottom - visibleBottom : input.targetTop - visibleTop;
  }

  const left = clamp(input.scrollLeft + deltaLeft, 0, Math.max(0, input.maxScrollLeft));
  const top = clamp(input.scrollTop + deltaTop, 0, Math.max(0, input.maxScrollTop));
  if (
    Math.abs(left - input.scrollLeft) < SCROLL_EPSILON_PX
    && Math.abs(top - input.scrollTop) < SCROLL_EPSILON_PX
  ) return undefined;
  return { left, top };
}
