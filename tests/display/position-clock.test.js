import { describe, expect, it } from 'vitest';

import {
  estimatePositionMs,
  isPositionClockAdvancing,
  retargetPositionClock,
  setPositionClockAdvancing,
  syncPositionClock,
} from '../../src/domain/display/position-clock.js';

const TRACK = 'bus|track|title|artist';

describe('syncPositionClock', () => {
  it('anchors a clock on a sample', () => {
    const clock = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 12_000,
      nowMs: 1_000,
      advancing: true,
      durationMs: 200_000,
    });

    expect(clock).toEqual({
      trackKey: TRACK,
      positionMs: 12_000,
      sampledAtMs: 1_000,
      advancing: true,
      rate: 1,
      durationMs: 200_000,
    });
  });

  it('rejects samples without a usable track key or position', () => {
    const base = { trackKey: TRACK, positionMs: 0, nowMs: 0, advancing: true };
    expect(syncPositionClock(null, { ...base, trackKey: '' })).toBeNull();
    expect(syncPositionClock(null, { ...base, positionMs: -1 })).toBeNull();
    expect(syncPositionClock(null, { ...base, positionMs: Number.NaN })).toBeNull();
    expect(syncPositionClock(null, { ...base, nowMs: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('replaces the clock outright when the track changes', () => {
    const first = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 100_000,
      nowMs: 0,
      advancing: true,
    });
    const second = syncPositionClock(first, {
      trackKey: 'other',
      positionMs: 0,
      nowMs: 10,
      advancing: true,
    });

    // A merged clock would extrapolate the previous song's position onto the new
    // track, which is what makes lyrics start mid-song after a track change.
    expect(second?.trackKey).toBe('other');
    expect(second?.positionMs).toBe(0);
  });

  it('treats absent, non-positive, and absurd rates as normal speed', () => {
    for (const rate of [undefined, null, 0, -2, 99, Number.NaN]) {
      const clock = syncPositionClock(null, {
        trackKey: TRACK,
        positionMs: 0,
        nowMs: 0,
        advancing: true,
        rate,
      });
      expect(clock?.rate).toBe(1);
    }
  });

  it('keeps a valid playback rate', () => {
    const clock = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 0,
      nowMs: 0,
      advancing: true,
      rate: 1.5,
    });
    expect(clock?.rate).toBe(1.5);
  });

  it('ignores a non-positive duration so the clamp does not pin the clock to zero', () => {
    const clock = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 5_000,
      nowMs: 0,
      advancing: true,
      durationMs: 0,
    });
    expect(clock?.durationMs).toBeNull();
    expect(estimatePositionMs(clock, 1_000)).toBe(6_000);
  });

  it('prevents retrograde position jumps on small D-Bus latency jitter', () => {
    const first = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 10_000,
      nowMs: 1_000,
      advancing: true,
    });

    // At nowMs = 1500, clock has estimated 10_500.
    // A D-Bus sample arrives reporting 10_350 due to 150ms roundtrip/quantization latency.
    const second = syncPositionClock(first, {
      trackKey: TRACK,
      positionMs: 10_350,
      nowMs: 1_500,
      advancing: true,
    });

    // Clock must not regress backwards
    expect(second?.positionMs).toBe(10_500);
    expect(second?.sampledAtMs).toBe(1_500);
  });

  it('accepts external seek jumps that exceed the seek threshold', () => {
    const first = syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: 50_000,
      nowMs: 1_000,
      advancing: true,
    });

    // External backward seek: 20s earlier
    const second = syncPositionClock(first, {
      trackKey: TRACK,
      positionMs: 30_000,
      nowMs: 1_500,
      advancing: true,
    });

    expect(second?.positionMs).toBe(30_000);
    expect(second?.sampledAtMs).toBe(1_500);
  });
});

describe('estimatePositionMs', () => {
  /**
   * @param {Partial<{ positionMs: number, advancing: boolean, rate: number, durationMs: number }>} overrides
   */
  function clockAt(overrides = {}) {
    return syncPositionClock(null, {
      trackKey: TRACK,
      positionMs: overrides.positionMs ?? 10_000,
      nowMs: 1_000,
      advancing: overrides.advancing ?? true,
      rate: overrides.rate,
      durationMs: overrides.durationMs,
    });
  }

  it('interpolates forward while advancing', () => {
    // 240 ms of wall clock is three word boundaries at typical word lengths; the
    // whole point of the clock is that this resolution needs no D-Bus traffic.
    expect(estimatePositionMs(clockAt(), 1_240)).toBe(10_240);
  });

  it('scales interpolation by the playback rate', () => {
    expect(estimatePositionMs(clockAt({ rate: 2 }), 1_500)).toBe(11_000);
  });

  it('holds the anchor while paused', () => {
    expect(estimatePositionMs(clockAt({ advancing: false }), 60_000)).toBe(10_000);
  });

  it('returns null for a missing clock', () => {
    expect(estimatePositionMs(null, 1_000)).toBeNull();
  });

  it('returns null when the clock belongs to another track', () => {
    expect(estimatePositionMs(clockAt(), 1_100, 'other-track')).toBeNull();
    expect(estimatePositionMs(clockAt(), 1_100, TRACK)).toBe(10_100);
  });

  it('never runs past the track duration', () => {
    expect(estimatePositionMs(clockAt({ positionMs: 9_500, durationMs: 10_000 }), 3_000)).toBe(
      10_000,
    );
  });

  it('does not go backwards when the monotonic reading is not newer', () => {
    expect(estimatePositionMs(clockAt(), 900)).toBe(10_000);
    expect(estimatePositionMs(clockAt(), 1_000)).toBe(10_000);
  });

  it('stops extrapolating once the sample is stale', () => {
    // A sample stream that dried up means the player stopped answering; showing
    // a confidently wrong line is worse than freezing on the last known one.
    expect(estimatePositionMs(clockAt(), 1_000 + 4_999)).toBe(14_999);
    expect(estimatePositionMs(clockAt(), 1_000 + 5_001)).toBe(10_000);
  });

  it('honours a custom staleness window', () => {
    expect(estimatePositionMs(clockAt(), 1_400, null, { maxExtrapolationMs: 300 })).toBe(10_000);
    expect(estimatePositionMs(clockAt(), 1_200, null, { maxExtrapolationMs: 300 })).toBe(10_200);
  });
});

describe('retargetPositionClock', () => {
  const clock = syncPositionClock(null, {
    trackKey: TRACK,
    positionMs: 10_000,
    nowMs: 1_000,
    advancing: true,
    durationMs: 100_000,
  });

  it('moves the anchor to a requested position and re-bases the timestamp', () => {
    const seeked = retargetPositionClock(clock, 45_000, 2_000);
    expect(seeked?.positionMs).toBe(45_000);
    expect(seeked?.sampledAtMs).toBe(2_000);
    // Interpolation resumes from the seek target, so the lyric line jumps at
    // once instead of waiting for the player's next Position report.
    expect(estimatePositionMs(seeked, 2_500)).toBe(45_500);
  });

  it('clamps a seek target to the duration', () => {
    expect(retargetPositionClock(clock, 500_000, 2_000)?.positionMs).toBe(100_000);
  });

  it('ignores invalid targets and missing clocks', () => {
    expect(retargetPositionClock(clock, -5, 2_000)).toBe(clock);
    expect(retargetPositionClock(clock, Number.NaN, 2_000)).toBe(clock);
    expect(retargetPositionClock(null, 1_000, 2_000)).toBeNull();
  });
});

describe('setPositionClockAdvancing', () => {
  const clock = syncPositionClock(null, {
    trackKey: TRACK,
    positionMs: 10_000,
    nowMs: 1_000,
    advancing: true,
  });

  it('banks elapsed time when pausing', () => {
    const paused = setPositionClockAdvancing(clock, false, 1_800);
    expect(paused?.advancing).toBe(false);
    expect(paused?.positionMs).toBe(10_800);
    // Frozen: a long pause must not walk the highlight through the line.
    expect(estimatePositionMs(paused, 60_000)).toBe(10_800);
  });

  it('resumes from where it was paused', () => {
    const paused = setPositionClockAdvancing(clock, false, 1_800);
    const resumed = setPositionClockAdvancing(paused, true, 30_000);
    expect(resumed?.positionMs).toBe(10_800);
    expect(estimatePositionMs(resumed, 30_400)).toBe(11_200);
  });

  it('is a no-op when the state already matches', () => {
    expect(setPositionClockAdvancing(clock, true, 5_000)).toBe(clock);
    expect(setPositionClockAdvancing(null, false, 5_000)).toBeNull();
  });
});

describe('isPositionClockAdvancing', () => {
  const clock = syncPositionClock(null, {
    trackKey: TRACK,
    positionMs: 10_000,
    nowMs: 1_000,
    advancing: true,
  });

  it('reports a fresh advancing clock as usable', () => {
    expect(isPositionClockAdvancing(clock, 1_080)).toBe(true);
    expect(isPositionClockAdvancing(clock, 1_000 + 4_999)).toBe(true);
  });

  it('reports a stale anchor as no longer usable', () => {
    // Past this point estimatePositionMs returns a constant, so a caller driving
    // a display tick from it would spin forever without observing any movement.
    expect(isPositionClockAdvancing(clock, 1_000 + 5_001)).toBe(false);
    expect(estimatePositionMs(clock, 1_000 + 5_001)).toBe(clock?.positionMs);
  });

  it('reports paused and missing clocks as not advancing', () => {
    const paused = setPositionClockAdvancing(clock, false, 1_100);
    expect(isPositionClockAdvancing(paused, 1_200)).toBe(false);
    expect(isPositionClockAdvancing(null, 1_200)).toBe(false);
  });

  it('honours a custom staleness window', () => {
    expect(isPositionClockAdvancing(clock, 1_400, { maxExtrapolationMs: 300 })).toBe(false);
    expect(isPositionClockAdvancing(clock, 1_200, { maxExtrapolationMs: 300 })).toBe(true);
  });
});
