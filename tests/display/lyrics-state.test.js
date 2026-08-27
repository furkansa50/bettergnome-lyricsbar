import { describe, expect, it } from 'vitest';

import {
  displayStateFromLookup,
  displayStateFromSyncedPosition,
} from '../../src/domain/display/lyrics-state.js';

/**
 * @import { PlayerSnapshot } from '../../src/domain/mpris/types.js'
 * @import { LyricsProviderResult } from '../../src/domain/lyrics/types.js'
 */

/**
 * @param {Partial<PlayerSnapshot>} overrides
 * @returns {PlayerSnapshot}
 */
function snapshot(overrides) {
  return {
    busName: 'org.mpris.MediaPlayer2.spotify',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    durationMs: 266773,
    trackId: '/com/spotify/track/abc',
    url: null,
    artUrl: null,
    playbackStatus: 'Playing',
    ...overrides,
  };
}

/** @type {Extract<LyricsProviderResult, { kind: 'synced' }>} */
const syncedLookup = {
  kind: 'synced',
  track: {
    trackName: 'Yellow',
    artistName: 'Coldplay',
    albumName: 'Parachutes',
    durationMs: 266773,
  },
  lines: [
    { timeMs: 1000, text: 'Look at the stars' },
    { timeMs: 4500, text: 'Look how they shine for you' },
  ],
  wordLines: [],
  plainText: 'Look at the stars\nLook how they shine for you',
};

describe('displayStateFromLookup', () => {
  it('returns idle when player is null', () => {
    expect(displayStateFromLookup(null, syncedLookup)).toEqual({ kind: 'idle' });
  });

  it('returns loading when player exists and lookup is null', () => {
    expect(displayStateFromLookup(snapshot({}), null)).toEqual({
      kind: 'loading',
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns the first synced line for a synced result', () => {
    expect(displayStateFromLookup(snapshot({}), syncedLookup)).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('preserves the current synced line for same-track refreshes', () => {
    expect(
      displayStateFromLookup(snapshot({}), syncedLookup, {
        previousState: {
          kind: 'lyrics',
          line: 'Look how they shine for you',
          words: [],
          activeWordIndex: -1,
          track: { title: 'Yellow', artist: 'Coldplay' },
        },
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'Look how they shine for you',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('does not preserve a synced line across track changes', () => {
    expect(
      displayStateFromLookup(snapshot({ title: 'Clocks' }), syncedLookup, {
        previousState: {
          kind: 'lyrics',
          line: 'Look how they shine for you',
          words: [],
          activeWordIndex: -1,
          track: { title: 'Yellow', artist: 'Coldplay' },
        },
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Clocks', artist: 'Coldplay' },
    });
  });

  it('does not downgrade synced lyrics to track display during lookup refreshes', () => {
    expect(
      displayStateFromLookup(snapshot({}), syncedLookup, {
        previousState: {
          kind: 'lyrics',
          line: 'Look how they shine for you',
          words: [],
          activeWordIndex: -1,
          track: { title: 'Yellow', artist: 'Coldplay' },
        },
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'Look how they shine for you',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('falls back to plainText when synced lines are all empty', () => {
    expect(
      displayStateFromLookup(snapshot({}), {
        ...syncedLookup,
        lines: [{ timeMs: 1000, text: ' ' }],
        plainText: 'Plain fallback line\nSecond plain',
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'Plain fallback line',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns the first non-empty plain line for a plain result', () => {
    expect(
      displayStateFromLookup(snapshot({}), {
        kind: 'plain',
        track: {
          trackName: 'Song',
          artistName: 'Artist',
          albumName: '',
          durationMs: null,
        },
        text: '\n\nFirst real line\nSecond line',
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'First real line',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns track display for instrumental tracks', () => {
    expect(
      displayStateFromLookup(snapshot({}), {
        kind: 'instrumental',
        track: {
          trackName: 'Atmosphere',
          artistName: 'Joy Division',
          albumName: '',
          durationMs: null,
        },
      }),
    ).toEqual({
      kind: 'track',
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns track display for not-found results', () => {
    expect(displayStateFromLookup(snapshot({}), { kind: 'not-found' })).toEqual({
      kind: 'track',
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns error display for error results', () => {
    expect(
      displayStateFromLookup(snapshot({}), {
        kind: 'error',
        reason: 'connection refused',
      }),
    ).toEqual({
      kind: 'error',
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('paints the line at a known position instead of the first line of the song', () => {
    // Painting lines[0] for a track already in progress is the "lyrics show up
    // late" symptom: the correct line only arrived on the next poll tick.
    expect(displayStateFromLookup(snapshot({}), syncedLookup, { positionMs: 5000 })).toEqual({
      kind: 'lyrics',
      line: 'Look how they shine for you',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('prefers a known position over a reusable previous state', () => {
    expect(
      displayStateFromLookup(snapshot({}), syncedLookup, {
        positionMs: 5000,
        previousState: {
          kind: 'lyrics',
          line: 'Look at the stars',
          words: [],
          activeWordIndex: -1,
          track: { title: 'Yellow', artist: 'Coldplay' },
        },
      }),
    ).toEqual({
      kind: 'lyrics',
      line: 'Look how they shine for you',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('still falls back to the first line when no position is known', () => {
    expect(displayStateFromLookup(snapshot({}), syncedLookup, { positionMs: null })).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });
});

describe('displayStateFromSyncedPosition', () => {
  it('selects the synced line at the current playback position', () => {
    expect(displayStateFromSyncedPosition(snapshot({}), syncedLookup, 5000)).toEqual({
      kind: 'lyrics',
      line: 'Look how they shine for you',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('displays the album name before the first timestamp when present', () => {
    expect(displayStateFromSyncedPosition(snapshot({}), syncedLookup, 500)).toEqual({
      kind: 'lyrics',
      line: 'Parachutes',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('falls back to the first lyric line before the first timestamp when album is missing', () => {
    expect(displayStateFromSyncedPosition(snapshot({ album: '' }), syncedLookup, 500)).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: [],
      activeWordIndex: -1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });

  it('returns idle when player is missing', () => {
    expect(displayStateFromSyncedPosition(null, syncedLookup, 5000)).toEqual({ kind: 'idle' });
  });

  it('selects correct word index and active word info with word-timed lines', () => {
    const wordTimedLookup = {
      kind: 'synced',
      track: {
        trackName: 'Yellow',
        artistName: 'Coldplay',
        albumName: 'Parachutes',
        durationMs: 266773,
      },
      lines: [
        { timeMs: 1000, text: 'Look at the stars' },
        { timeMs: 4500, text: 'Look how they shine for you' },
      ],
      wordLines: [
        {
          timeMs: 1000,
          endMs: 4000,
          text: 'Look at the stars',
          words: [
            { beginMs: 1000, endMs: 1500, text: 'Look' },
            { beginMs: 1500, endMs: 2000, text: 'at' },
            { beginMs: 2000, endMs: 2500, text: 'the' },
            { beginMs: 2500, endMs: 3500, text: 'stars' },
          ],
        },
      ],
      plainText: 'Look at the stars\nLook how they shine for you',
    };

    // Position is within the first word
    expect(displayStateFromSyncedPosition(snapshot({}), wordTimedLookup, 1200)).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: wordTimedLookup.wordLines[0]?.words,
      activeWordIndex: 0,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });

    // Position is within the second word
    expect(displayStateFromSyncedPosition(snapshot({}), wordTimedLookup, 1700)).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: wordTimedLookup.wordLines[0]?.words,
      activeWordIndex: 1,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });

    // Position is after the line's endMs (4000) but before the next line (4500).
    // The word line stays selected so the label keeps rendering the same word
    // markup: dropping it here made the panel swap between word markup and the
    // plain line inside a single lyric line, which is visible as flicker. The
    // pointer moves past the last word so no word stays stuck in the active
    // style during the gap.
    expect(displayStateFromSyncedPosition(snapshot({}), wordTimedLookup, 4200)).toEqual({
      kind: 'lyrics',
      line: 'Look at the stars',
      words: wordTimedLookup.wordLines[0]?.words,
      activeWordIndex: 4,
      track: { title: 'Yellow', artist: 'Coldplay' },
    });
  });
});
