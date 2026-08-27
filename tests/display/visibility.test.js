import { describe, expect, it } from 'vitest';

import { isActiveMusicPlayer, shouldHideIndicator } from '../../src/domain/display/visibility.js';

/**
 * @import { PlayerSnapshot } from '../../src/domain/mpris/types.js'
 */

/**
 * @param {Partial<PlayerSnapshot>} overrides
 * @returns {PlayerSnapshot}
 */
function snapshot(overrides = {}) {
  return {
    busName: 'org.mpris.MediaPlayer2.spotify',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    durationMs: 200_000,
    trackId: '/track/1',
    url: null,
    artUrl: null,
    playbackStatus: 'Playing',
    ...overrides,
  };
}

describe('isActiveMusicPlayer', () => {
  it('treats playing and paused players as in use', () => {
    expect(isActiveMusicPlayer(snapshot({ playbackStatus: 'Playing' }))).toBe(true);
    // Paused counts: a bar that vanishes on every pause is worse than one that
    // stays while the user is still inside the player.
    expect(isActiveMusicPlayer(snapshot({ playbackStatus: 'Paused' }))).toBe(true);
  });

  it('treats stopped and missing players as not in use', () => {
    // Browser MPRIS clients keep advertising a stopped player long after
    // playback ended, so Stopped must not keep the bar on screen.
    expect(isActiveMusicPlayer(snapshot({ playbackStatus: 'Stopped' }))).toBe(false);
    expect(isActiveMusicPlayer(null)).toBe(false);
    expect(isActiveMusicPlayer(undefined)).toBe(false);
  });
});

describe('shouldHideIndicator', () => {
  it('hides the bar by default when no player is active', () => {
    expect(shouldHideIndicator({ hideWhenIdle: true, player: null })).toBe(true);
    expect(
      shouldHideIndicator({ hideWhenIdle: true, player: snapshot({ playbackStatus: 'Stopped' }) }),
    ).toBe(true);
  });

  it('shows the bar while a player is playing or paused', () => {
    expect(shouldHideIndicator({ hideWhenIdle: true, player: snapshot() })).toBe(false);
    expect(
      shouldHideIndicator({ hideWhenIdle: true, player: snapshot({ playbackStatus: 'Paused' }) }),
    ).toBe(false);
  });

  it('never hides when the preference is off', () => {
    expect(shouldHideIndicator({ hideWhenIdle: false, player: null })).toBe(false);
    expect(
      shouldHideIndicator({ hideWhenIdle: false, player: snapshot({ playbackStatus: 'Stopped' }) }),
    ).toBe(false);
  });
});
