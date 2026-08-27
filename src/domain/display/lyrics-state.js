import { lastIndexAtOrBefore, selectLyricLineIndex } from '../lyrics/lrc.js';

/**
 * @import { PlayerSnapshot } from '../mpris/types.js'
 * @import { LyricsProviderResult, WordTimedLyricLine } from '../lyrics/types.js'
 * @import { DisplayState, DisplayTrack } from './types.js'
 *
 * @typedef {Readonly<{
 *   previousState?: DisplayState | null | undefined,
 *   positionMs?: number | null | undefined,
 * }>} DisplayLookupOptions
 *
 * @typedef {Readonly<{
 *   lineIndex: number,
 *   wordLineIndex: number,
 *   activeWordIndex: number,
 * }>} SyncedHighlight
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
      // A known position must win over the first line of the song. Painting
      // `lines[0]` while playback is already underway is the "lyrics show up
      // late" symptom: the correct line only arrived on the next poll tick.
      if (typeof options.positionMs === 'number' && Number.isFinite(options.positionMs)) {
        return displayStateFromSyncedPosition(player, lookup, options.positionMs);
      }
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

  // One selection pass shared with selectSyncedHighlight, so the cheap
  // change-detection callers do and the state built here can never disagree.
  const highlight = selectSyncedHighlight(lookup, positionMs);
  const line = highlight.lineIndex === -1 ? null : (lookup.lines[highlight.lineIndex] ?? null);
  if (line !== null && line.text.trim() !== '') {
    const wordLine =
      highlight.wordLineIndex === -1 ? null : (lookup.wordLines[highlight.wordLineIndex] ?? null);
    if (wordLine !== null && wordLine !== undefined) {
      return {
        kind: 'lyrics',
        // Use the word-timed line's own text so the rendered label is always the
        // concatenation of the words being highlighted. Mixing it with the plain
        // synced line makes the label swap between two spellings of the same
        // line, which is visible as flicker in the panel.
        line: wordLine.text,
        words: wordLine.words,
        activeWordIndex: highlight.activeWordIndex,
        track,
      };
    }
    return { kind: 'lyrics', line: line.text, words: [], activeWordIndex: -1, track };
  }

  return displayStateFromLookup(player, lookup);
}

/**
 * Find the word-timed line that applies at the given position.
 *
 * The line stays selected until the next word-timed line starts rather than
 * being dropped at its own `endMs`. Dropping it early makes the panel fall back
 * to the plain synced line, so the label alternates between word markup and
 * plain text within a single lyric line.
 *
 * @param {readonly WordTimedLyricLine[] | undefined} wordLines
 * @param {number} positionMs
 * @returns {WordTimedLyricLine | null}
 */
export function findWordTimedLine(wordLines, positionMs) {
  const index = findWordTimedLineIndex(wordLines, positionMs);
  return index === -1 ? null : (wordLines?.[index] ?? null);
}

/**
 * Index of the applicable word-timed line, or -1.
 *
 * @param {readonly WordTimedLyricLine[] | undefined} wordLines
 * @param {number} positionMs
 * @returns {number}
 */
function findWordTimedLineIndex(wordLines, positionMs) {
  if (!wordLines || wordLines.length === 0) {
    return -1;
  }

  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return -1;
  }

  return lastIndexAtOrBefore(wordLines, positionMs, readWordLineTimeMs);
}

/**
 * Selection indices for a position, without building a display state.
 *
 * The word-highlight tick runs many times per second but the highlight only
 * moves on a fraction of those ticks. Callers compare this cheap result first
 * and skip rebuilding state and markup when nothing moved.
 *
 * @param {Extract<LyricsProviderResult, { kind: 'synced' }>} lookup
 * @param {number} positionMs
 * @returns {SyncedHighlight}
 */
export function selectSyncedHighlight(lookup, positionMs) {
  const wordLineIndex = findWordTimedLineIndex(lookup.wordLines, positionMs);
  const wordLine = wordLineIndex === -1 ? null : lookup.wordLines[wordLineIndex];

  return {
    lineIndex: selectLyricLineIndex(lookup.lines, positionMs),
    wordLineIndex,
    activeWordIndex:
      wordLine === undefined || wordLine === null
        ? -1
        : selectActiveWordIndex(wordLine, positionMs),
  };
}

/**
 * Index of the word the highlight has reached, or -1 before the line starts.
 *
 * The return value is a progress pointer, not strictly "the word being sung":
 * callers render words before it as already sung, the word at it as active, and
 * words after it as upcoming. Once the whole line is finished the pointer moves
 * past the last word (`words.length`) so no word stays stuck in the active
 * style during instrumental gaps or after the final line.
 *
 * @param {WordTimedLyricLine} wordLine
 * @param {number} positionMs
 * @returns {number}
 */
export function selectActiveWordIndex(wordLine, positionMs) {
  const { words } = wordLine;
  if (words.length === 0) {
    return -1;
  }

  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return -1;
  }

  const lastWord = words[words.length - 1];
  const lineEndMs = Math.max(wordLine.endMs, lastWord?.endMs ?? wordLine.endMs);
  if (positionMs > lineEndMs) {
    return words.length;
  }

  return lastIndexAtOrBefore(words, positionMs, readWordBeginMs);
}

/**
 * @param {WordTimedLyricLine} wordLine
 * @returns {number}
 */
function readWordLineTimeMs(wordLine) {
  return wordLine.timeMs;
}

/**
 * @param {import('../lyrics/types.js').WordTiming} word
 * @returns {number}
 */
function readWordBeginMs(word) {
  return word.beginMs;
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
