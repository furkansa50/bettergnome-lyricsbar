import { describe, expect, it } from 'vitest';

import {
  estimatePositionMs,
  retargetPositionClock,
  syncPositionClock,
} from '../../src/domain/display/position-clock.js';
import { shouldHoldLowConfidenceSyncedPosition } from '../../src/domain/display/sync-position-policy.js';

describe('Firefox Position Sync and Seek Stability', () => {
  const firefoxPlayer = {
    busName: 'org.mpris.MediaPlayer2.firefox.instance_1_72',
    title: 'Birds Dont Sing',
    artist: 'TV Girl',
    album: 'French Exit',
    durationMs: 213000,
    trackId: '/org/mpris/MediaPlayer2/firefox',
    url: 'https://music.youtube.com/watch?v=KTyrYafcS3Y',
    artUrl: null,
    playbackStatus: /** @type {const} */ ('Playing'),
  };

  const trackKey = 'org.mpris.MediaPlayer2.firefox.instance_1_72|Birds Dont Sing|TV Girl';

  it('allows the very first zero sample to initialize the playback clock at track start', () => {
    const isHeld = shouldHoldLowConfidenceSyncedPosition(firefoxPlayer, 0, {
      hasAcceptedSyncedPosition: false,
      hasPreviousSyncedLine: false,
    });

    expect(isHeld).toBe(false);

    const clock = syncPositionClock(null, {
      trackKey,
      positionMs: 0,
      nowMs: 10000,
      advancing: true,
      durationMs: 213000,
    });

    expect(clock).not.toBeNull();
    expect(estimatePositionMs(clock, 10000)).toBe(0);
    expect(estimatePositionMs(clock, 13500)).toBe(3500);
  });

  it('holds subsequent zero-position samples from Firefox so advancing clock is not reset', () => {
    // After initial sample was accepted
    const isHeld = shouldHoldLowConfidenceSyncedPosition(firefoxPlayer, 0, {
      hasAcceptedSyncedPosition: true,
      hasPreviousSyncedLine: false,
    });

    expect(isHeld).toBe(true);
  });

  it('preserves seek target when Firefox reports zero on subsequent polls', () => {
    // Clock is running at 3s
    let clock = syncPositionClock(null, {
      trackKey,
      positionMs: 0,
      nowMs: 10000,
      advancing: true,
      durationMs: 213000,
    });

    expect(estimatePositionMs(clock, 13000)).toBe(3000);

    // User seeks to 90s (1:30) at nowMs 13000
    clock = retargetPositionClock(clock, 90000, 13000);
    expect(estimatePositionMs(clock, 13000)).toBe(90000);

    // Firefox D-Bus returns Position = 0 on the next poll at 13500ms
    const isHeld = shouldHoldLowConfidenceSyncedPosition(firefoxPlayer, 0, {
      hasAcceptedSyncedPosition: true,
      hasPreviousSyncedLine: true,
    });

    expect(isHeld).toBe(true);

    // The held sample is skipped, so the clock continues advancing from 90s!
    expect(estimatePositionMs(clock, 15000)).toBe(92000);
  });

  it('re-anchors the clock when Firefox reports a real positive position', () => {
    let clock = syncPositionClock(null, {
      trackKey,
      positionMs: 0,
      nowMs: 10000,
      advancing: true,
      durationMs: 213000,
    });

    // Real position 45s arrived from D-Bus
    const isHeld = shouldHoldLowConfidenceSyncedPosition(firefoxPlayer, 45000, {
      hasAcceptedSyncedPosition: true,
      hasPreviousSyncedLine: true,
    });

    expect(isHeld).toBe(false);

    clock = syncPositionClock(clock, {
      trackKey,
      positionMs: 45000,
      nowMs: 30000,
      advancing: true,
      durationMs: 213000,
    });

    expect(estimatePositionMs(clock, 32000)).toBe(47000);
  });
});
