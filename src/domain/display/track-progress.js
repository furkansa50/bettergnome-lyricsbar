/**
 * Pure arithmetic for the details popup's progress row and lyrics auto-scroll.
 *
 * Kept in the domain layer so the maths can be tested without shell widgets; the
 * shell layer only converts the results into pixel sizes and adjustment values.
 */

/**
 * Format a millisecond position as `M:SS`.
 *
 * Missing or nonsensical values render as `0:00` rather than blank, so the
 * progress row keeps a stable width while a player is still starting up.
 *
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatTrackTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Elapsed fraction of a track, clamped to 0..1.
 *
 * @param {number | null | undefined} positionMs
 * @param {number | null | undefined} durationMs
 * @returns {number}
 */
export function computeProgressFraction(positionMs, durationMs) {
  if (
    typeof positionMs !== 'number' ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(positionMs) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return 0;
  }

  return clampFraction(positionMs / durationMs);
}

/**
 * Absolute seek target for a click at `fraction` along the progress bar.
 *
 * Returns null when the duration is unknown: seeking to an unknown position
 * would be worse than ignoring the click.
 *
 * @param {number} fraction Position along the bar, 0..1.
 * @param {number | null | undefined} durationMs
 * @returns {number | null}
 */
export function computeSeekPositionMs(fraction, durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return null;
  }

  return Math.round(clampFraction(fraction) * durationMs);
}

/**
 * Fraction of the bar a pointer press landed on.
 *
 * @param {number} localX Pointer x relative to the bar's own origin.
 * @param {number} barWidth Allocated bar width in pixels.
 * @returns {number | null}
 */
export function computeBarFraction(localX, barWidth) {
  if (typeof barWidth !== 'number' || !Number.isFinite(barWidth) || barWidth <= 0) {
    return null;
  }

  if (typeof localX !== 'number' || !Number.isFinite(localX)) {
    return null;
  }

  return clampFraction(localX / barWidth);
}

/**
 * Scroll offset that centres a lyric line inside the visible page.
 *
 * Returns null while the scroll view is unallocated (`pageSize <= 0`), which is
 * the case before the popup has been opened for the first time.
 *
 * @param {{
 *   childY: number,
 *   childHeight: number,
 *   pageSize: number,
 *   upper?: number | null | undefined,
 * }} metrics
 * @returns {number | null}
 */
export function computeScrollValue(metrics) {
  const { childY, childHeight, pageSize, upper } = metrics;

  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  if (!Number.isFinite(childY) || !Number.isFinite(childHeight)) {
    return null;
  }

  const centered = childY - pageSize / 2 + childHeight / 2;

  // `upper` is the full scrollable height. When it is unknown, only the lower
  // bound is enforced; the adjustment clamps the value itself on assignment.
  const maxValue =
    typeof upper === 'number' && Number.isFinite(upper) && upper > 0
      ? Math.max(0, upper - pageSize)
      : Number.POSITIVE_INFINITY;

  return Math.max(0, Math.min(maxValue, centered));
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampFraction(value) {
  return Math.min(1, Math.max(0, value));
}
