import { selectLyricLine } from '../lyrics/lrc.js';

/**
 * @import { PlayerSnapshot } from '../mpris/types.js'
 * @import { LyricsProviderResult, WordTimedLyricLine } from '../lyrics/types.js'
 * @import { DisplayState, DisplayTrack } from './types.js'
 *
 * @typedef {Readonly<{
 *   previousState?: DisplayState | null | undefined,
 * }>} DisplayLookupOptions
 */

/**
 * @param {PlayerSnapshot | null | undefined} player
 * @param {LyricsProviderResult | null | undefined} lookup
 * @param {DisplayLookupOptions} [options]
 * @returns {DisplayState}
 */
export function displayStateFromLookup(player, lookup, options = {}) {
  if (player === null || player === undefined) {
    return { kind: 'idle' };
  }

  /** @type {DisplayTrack} */
  const track = { title: player.title, artist: player.artist };

  if (lookup === null || lookup === undefined) {
    return { kind: 'loading', track };
  }

  switch (lookup.kind) {
    case 'synced':
      if (
        options.previousState?.kind === 'lyrics' &&
        sameDisplayTrack(options.previousState.track, track)
      ) {
        return options.previousState;
      }
      return {
        kind: 'lyrics',
        line: extractFirstSyncedLine(lookup),
        words: [],
        activeWordIndex: -1,
        track,
      };
    case 'plain':
      return {
        kind: 'lyrics',
        line: extractFirstPlainLine(lookup),
        words: [],
        activeWordIndex: -1,
        track,
      };
    case 'instrumental':
      return { kind: 'track', track };
    case 'not-found':
      return { kind: 'track', track };
    case 'error':
      return { kind: 'error', track };
    default:
      return { kind: 'track', track };
  }
}

/**
 * @param {DisplayTrack} left
 * @param {DisplayTrack} right
 * @returns {boolean}
 */
function sameDisplayTrack(left, right) {
  return left.title === right.title && left.artist === right.artist;
}

/**
 * Build a display state from a synced position, including word-level
 * highlight data when word timing is available.
 *
 * @param {PlayerSnapshot | null | undefined} player
 * @param {Extract<LyricsProviderResult, { kind: 'synced' }>} lookup
 * @param {number} positionMs
 * @returns {DisplayState}
 */
export function displayStateFromSyncedPosition(player, lookup, positionMs) {
  if (player === null || player === undefined) {
    return { kind: 'idle' };
  }

  /** @type {DisplayTrack} */
  const track = { title: player.title, artist: player.artist };

  const firstLine = lookup.lines[0];
  if (firstLine && positionMs < firstLine.timeMs) {
    if (player.album && player.album.trim() !== '') {
      return {
        kind: 'lyrics',
        line: player.album,
        words: [],
        activeWordIndex: -1,
        track,
      };
    }
  }

  const line = selectLyricLine(lookup.lines, positionMs);
  if (line !== null && line.text.trim() !== '') {
    // Find matching word-timed line for glow effect
    const wordLine = findWordTimedLine(lookup.wordLines, positionMs);
    if (wordLine !== null) {
      const activeWordIndex = selectActiveWordIndex(wordLine, positionMs);
      return {
        kind: 'lyrics',
        line: line.text,
        words: wordLine.words,
        activeWordIndex,
        track,
      };
    }
    return { kind: 'lyrics', line: line.text, words: [], activeWordIndex: -1, track };
  }

  return displayStateFromLookup(player, lookup);
}

/**
 * Find the word-timed line that covers the given position.
 *
 * @param {readonly WordTimedLyricLine[] | undefined} wordLines
 * @param {number} positionMs
 * @returns {WordTimedLyricLine | null}
 */
function findWordTimedLine(wordLines, positionMs) {
  if (!wordLines || wordLines.length === 0) {
    return null;
  }

  let current = null;
  for (const wl of wordLines) {
    if (wl.timeMs > positionMs) {
      break;
    }
    current = wl;
  }

  // Check if the position is still within the line's end time
  if (current !== null && positionMs <= current.endMs) {
    return current;
  }

  return null;
}

/**
 * Find which word is currently active (being sung) at the given position.
 *
 * @param {WordTimedLyricLine} wordLine
 * @param {number} positionMs
 * @returns {number}  Index of the active word, or -1 if none.
 */
function selectActiveWordIndex(wordLine, positionMs) {
  const { words } = wordLine;
  if (words.length === 0) {
    return -1;
  }

  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (w !== undefined && positionMs >= w.beginMs) {
      return i;
    }
  }

  return -1;
}

/**
 * @param {Extract<LyricsProviderResult, { kind: 'synced' }>} lookup
 * @returns {string}
 */
function extractFirstSyncedLine(lookup) {
  for (const line of lookup.lines) {
    if (line.text.trim() !== '') {
      return line.text;
    }
  }
  return extractFirstNonEmptyLine(lookup.plainText);
}

/**
 * @param {Extract<LyricsProviderResult, { kind: 'plain' }>} lookup
 * @returns {string}
 */
function extractFirstPlainLine(lookup) {
  return extractFirstNonEmptyLine(lookup.text);
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractFirstNonEmptyLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return '';
}
