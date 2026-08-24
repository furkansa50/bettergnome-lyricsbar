import { describe, expect, it } from 'vitest';

import {
  shouldPollPlayerPosition,
  shouldPollSyncedLyrics,
} from '../../src/domain/display/sync-polling.js';

/**
 * @import { LyricsProviderResult } from '../../src/domain/lyrics/types.js'
 * @import { PlayerSnapshot } from '../../src/domain/mpris/types.js'
 */

/** @type {LyricsProviderResult} */
const syncedLookup = Object.freeze({
  kind: 'synced',
  track: Object.freeze({
    trackName: 'Nina',
    artistName: '.Feast',
    albumName: 'Nina',
    durationMs: 277991,
  }),
  lines: Object.freeze([Object.freeze({ timeMs: 1000, text: 'Saat engkau tertidur' })]),
  plainText: 'Saat engkau tertidur',
});

/** @type {LyricsProviderResult} */
const plainLookup = Object.freeze({
  kind: 'plain',
  track: Object.freeze({
    trackName: 'Nina',
    artistName: '.Feast',
    albumName: 'Nina',
    durationMs: 277991,
  }),
  text: 'Saat engkau tertidur',
});

describe('shouldPollSyncedLyrics', () => {
  it('polls synced lyrics for playing players', () => {
    expect(
      shouldPollSyncedLyrics({
        enabled: true,
        player: snapshot({ playbackStatus: 'Playing' }),
        lookup: syncedLookup,
      }),
    ).toBe(true);
  });

  it('polls synced lyrics for paused browser players so a valid position can recover display', () => {
    expect(
      shouldPollSyncedLyrics({
        enabled: true,
        player: snapshot({ playbackStatus: 'Paused' }),
        lookup: syncedLookup,
      }),
    ).toBe(true);
  });

  it('polls synced lyrics for stopped browser players because position reads are authoritative', () => {
    expect(
      shouldPollSyncedLyrics({
        enabled: true,
        player: snapshot({ playbackStatus: 'Stopped' }),
        lookup: syncedLookup,
      }),
    ).toBe(true);
  });

  it('does not poll without a synced lookup', () => {
    expect(
      shouldPollSyncedLyrics({
        enabled: true,
        player: snapshot({ playbackStatus: 'Playing' }),
        lookup: plainLookup,
      }),
    ).toBe(false);
  });

  it('polls synced lyrics for Apple Music Web so per-sample position validation can recover display', () => {
    expect(
      shouldPollSyncedLyrics({
        enabled: true,
        player: snapshot({
          busName: 'org.mpris.MediaPlayer2.chromium.instance4621',
          durationMs: 2308029,
          trackId: '/org/chromium/MediaPlayer2/TrackList/TrackNatural',
        }),
        lookup: syncedLookup,
        browserPlayerService: 'apple-music',
      }),
    ).toBe(true);
  });
});

describe('shouldPollPlayerPosition', () => {
  it('polls while a player is advancing so the popup clock stays live', () => {
    expect(
      shouldPollPlayerPosition({
        enabled: true,
        player: snapshot({ playbackStatus: 'Playing' }),
      }),
    ).toBe(true);
  });

  it('polls regardless of whether lyrics were found', () => {
    // Unlike shouldPollSyncedLyrics this takes no lookup: the progress bar has
    // to advance for instrumental tracks and lyric misses too.
    expect(
      shouldPollPlayerPosition({
        enabled: true,
        player: snapshot({ busName: 'org.mpris.MediaPlayer2.spotify' }),
      }),
    ).toBe(true);
  });

  it('does not poll a paused or stopped player', () => {
    expect(
      shouldPollPlayerPosition({
        enabled: true,
        player: snapshot({ playbackStatus: 'Paused' }),
      }),
    ).toBe(false);
    expect(
      shouldPollPlayerPosition({
        enabled: true,
        player: snapshot({ playbackStatus: 'Stopped' }),
      }),
    ).toBe(false);
  });

  it('does not poll without a player or while disabled', () => {
    expect(shouldPollPlayerPosition({ enabled: true, player: null })).toBe(false);
    expect(
      shouldPollPlayerPosition({
        enabled: false,
        player: snapshot({ playbackStatus: 'Playing' }),
      }),
    ).toBe(false);
  });
});

/**
 * @param {Partial<PlayerSnapshot>} overrides
 * @returns {PlayerSnapshot}
 */
function snapshot(overrides) {
  return {
    busName: 'org.mpris.MediaPlayer2.chromium.instance7080',
    title: 'Nina',
    artist: '.Feast',
    album: 'Nina',
    durationMs: 277991,
    trackId: '/org/chromium/MediaPlayer2/TrackList/Nina',
    url: null,
    artUrl: null,
    playbackStatus: 'Playing',
    ...overrides,
  };
}
