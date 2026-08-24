import { describe, expect, it } from 'vitest';

import {
  computeBarFraction,
  computeProgressFraction,
  computeScrollValue,
  computeSeekPositionMs,
  formatTrackTime,
} from '../../src/domain/display/track-progress.js';

describe('formatTrackTime', () => {
  it('formats milliseconds as M:SS', () => {
    expect(formatTrackTime(0)).toBe('0:00');
    expect(formatTrackTime(9000)).toBe('0:09');
    expect(formatTrackTime(65_000)).toBe('1:05');
    expect(formatTrackTime(215_500)).toBe('3:35');
  });

  it('falls back to 0:00 for unusable values', () => {
    expect(formatTrackTime(null)).toBe('0:00');
    expect(formatTrackTime(undefined)).toBe('0:00');
    expect(formatTrackTime(-1)).toBe('0:00');
    expect(formatTrackTime(Number.NaN)).toBe('0:00');
  });
});

describe('computeProgressFraction', () => {
  it('returns the elapsed fraction', () => {
    expect(computeProgressFraction(30_000, 120_000)).toBeCloseTo(0.25);
  });

  it('clamps to 0..1', () => {
    expect(computeProgressFraction(-5, 100)).toBe(0);
    expect(computeProgressFraction(500, 100)).toBe(1);
  });

  it('returns 0 when the duration is unknown', () => {
    expect(computeProgressFraction(30_000, null)).toBe(0);
    expect(computeProgressFraction(30_000, 0)).toBe(0);
    expect(computeProgressFraction(null, 120_000)).toBe(0);
  });
});

describe('computeSeekPositionMs', () => {
  it('maps a bar fraction to an absolute position', () => {
    expect(computeSeekPositionMs(0.5, 200_000)).toBe(100_000);
    expect(computeSeekPositionMs(0, 200_000)).toBe(0);
    expect(computeSeekPositionMs(1, 200_000)).toBe(200_000);
  });

  it('clamps out-of-range fractions', () => {
    expect(computeSeekPositionMs(-0.5, 200_000)).toBe(0);
    expect(computeSeekPositionMs(1.5, 200_000)).toBe(200_000);
  });

  it('refuses to seek without a usable duration', () => {
    expect(computeSeekPositionMs(0.5, null)).toBeNull();
    expect(computeSeekPositionMs(0.5, 0)).toBeNull();
    expect(computeSeekPositionMs(Number.NaN, 200_000)).toBeNull();
  });
});

describe('computeBarFraction', () => {
  it('converts a local pointer x into a fraction', () => {
    expect(computeBarFraction(75, 150)).toBeCloseTo(0.5);
  });

  it('clamps presses outside the bar', () => {
    expect(computeBarFraction(-20, 150)).toBe(0);
    expect(computeBarFraction(400, 150)).toBe(1);
  });

  it('returns null while the bar is unallocated', () => {
    expect(computeBarFraction(10, 0)).toBeNull();
    expect(computeBarFraction(10, Number.NaN)).toBeNull();
  });
});

describe('computeScrollValue', () => {
  it('centres the active line in the visible page', () => {
    const value = computeScrollValue({
      childY: 500,
      childHeight: 20,
      pageSize: 200,
      upper: 1000,
    });

    expect(value).toBe(410);
  });

  it('never scrolls above the top', () => {
    const value = computeScrollValue({
      childY: 10,
      childHeight: 20,
      pageSize: 200,
      upper: 1000,
    });

    expect(value).toBe(0);
  });

  it('never scrolls past the last page', () => {
    const value = computeScrollValue({
      childY: 980,
      childHeight: 20,
      pageSize: 200,
      upper: 1000,
    });

    expect(value).toBe(800);
  });

  it('skips the upper clamp when the content height is unknown', () => {
    const value = computeScrollValue({
      childY: 500,
      childHeight: 20,
      pageSize: 200,
      upper: 0,
    });

    expect(value).toBe(410);
  });

  it('returns null while the scroll view is unallocated', () => {
    expect(
      computeScrollValue({ childY: 500, childHeight: 20, pageSize: 0, upper: 1000 }),
    ).toBeNull();
  });
});
