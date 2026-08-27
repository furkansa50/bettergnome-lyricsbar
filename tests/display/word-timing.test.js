import { describe, expect, it } from 'vitest';

import {
  findWordTimedLine,
  selectActiveWordIndex,
  selectSyncedHighlight,
} from '../../src/domain/display/lyrics-state.js';

/**
 * @import { WordTimedLyricLine } from '../../src/domain/lyrics/types.js'
 */

/**
 * Synthetic word-timed lines with placeholder words, so the expectations describe
 * timing behavior rather than any particular song.
 *
 * @type {readonly WordTimedLyricLine[]}
 */
const wordLines = Object.freeze([
  Object.freeze({
    timeMs: 1_000,
    endMs: 2_000,
    text: 'alpha bravo charlie',
    words: Object.freeze([
      Object.freeze({ beginMs: 1_000, endMs: 1_300, text: 'alpha' }),
      Object.freeze({ beginMs: 1_300, endMs: 1_600, text: 'bravo' }),
      Object.freeze({ beginMs: 1_600, endMs: 2_000, text: 'charlie' }),
    ]),
  }),
  Object.freeze({
    timeMs: 5_000,
    endMs: 6_000,
    text: 'delta echo',
    words: Object.freeze([
      Object.freeze({ beginMs: 5_000, endMs: 5_500, text: 'delta' }),
      Object.freeze({ beginMs: 5_500, endMs: 6_000, text: 'echo' }),
    ]),
  }),
]);

describe('findWordTimedLine', () => {
  it('returns null before the first line starts', () => {
    expect(findWordTimedLine(wordLines, 999)).toBeNull();
  });

  it('selects the line covering the position', () => {
    expect(findWordTimedLine(wordLines, 1_000)?.text).toBe('alpha bravo charlie');
    expect(findWordTimedLine(wordLines, 1_900)?.text).toBe('alpha bravo charlie');
    expect(findWordTimedLine(wordLines, 5_200)?.text).toBe('delta echo');
  });

  it('keeps the last line selected through the gap before the next one', () => {
    // Dropping the line at its own endMs made the panel fall back to the plain
    // synced line and then swap back to word markup, which is visible flicker.
    expect(findWordTimedLine(wordLines, 2_500)?.text).toBe('alpha bravo charlie');
    expect(findWordTimedLine(wordLines, 4_999)?.text).toBe('alpha bravo charlie');
  });

  it('keeps the final line selected after the song text ends', () => {
    expect(findWordTimedLine(wordLines, 600_000)?.text).toBe('delta echo');
  });

  it('handles empty and invalid input', () => {
    expect(findWordTimedLine([], 1_000)).toBeNull();
    expect(findWordTimedLine(undefined, 1_000)).toBeNull();
    expect(findWordTimedLine(wordLines, -1)).toBeNull();
    expect(findWordTimedLine(wordLines, Number.NaN)).toBeNull();
  });
});

describe('selectActiveWordIndex', () => {
  const line = /** @type {WordTimedLyricLine} */ (wordLines[0]);

  it('returns -1 before the first word begins', () => {
    expect(selectActiveWordIndex(line, 999)).toBe(-1);
  });

  it('advances the pointer word by word', () => {
    expect(selectActiveWordIndex(line, 1_000)).toBe(0);
    expect(selectActiveWordIndex(line, 1_299)).toBe(0);
    expect(selectActiveWordIndex(line, 1_300)).toBe(1);
    expect(selectActiveWordIndex(line, 1_599)).toBe(1);
    expect(selectActiveWordIndex(line, 1_600)).toBe(2);
    expect(selectActiveWordIndex(line, 2_000)).toBe(2);
  });

  it('moves past the last word once the line is finished', () => {
    // Previously the final word stayed highlighted forever, so an instrumental
    // gap or the end of the song left one word stuck in the active style.
    expect(selectActiveWordIndex(line, 2_001)).toBe(3);
    expect(selectActiveWordIndex(line, 60_000)).toBe(3);
  });

  it('respects a word that ends after the declared line end', () => {
    const trailing = /** @type {WordTimedLyricLine} */ ({
      timeMs: 0,
      endMs: 1_000,
      text: 'foxtrot',
      words: [{ beginMs: 0, endMs: 4_000, text: 'foxtrot' }],
    });
    expect(selectActiveWordIndex(trailing, 3_000)).toBe(0);
    expect(selectActiveWordIndex(trailing, 4_001)).toBe(1);
  });

  it('handles lines without words and invalid positions', () => {
    const empty = /** @type {WordTimedLyricLine} */ ({
      timeMs: 0,
      endMs: 100,
      text: '',
      words: [],
    });
    expect(selectActiveWordIndex(empty, 50)).toBe(-1);
    expect(selectActiveWordIndex(line, -1)).toBe(-1);
    expect(selectActiveWordIndex(line, Number.NaN)).toBe(-1);
  });
});

describe('selectSyncedHighlight', () => {
  const lookup = /** @type {any} */ ({
    kind: 'synced',
    track: { trackName: 'T', artistName: 'A', albumName: '', durationMs: 10_000 },
    lines: [
      { timeMs: 1_000, text: 'alpha bravo charlie' },
      { timeMs: 5_000, text: 'delta echo' },
    ],
    wordLines,
    plainText: 'alpha bravo charlie\ndelta echo',
  });

  it('reports -1 for every index before the first line', () => {
    expect(selectSyncedHighlight(lookup, 500)).toEqual({
      lineIndex: -1,
      wordLineIndex: -1,
      activeWordIndex: -1,
    });
  });

  it('reports the selected line, word line, and word pointer', () => {
    expect(selectSyncedHighlight(lookup, 1_400)).toEqual({
      lineIndex: 0,
      wordLineIndex: 0,
      activeWordIndex: 1,
    });
    expect(selectSyncedHighlight(lookup, 5_600)).toEqual({
      lineIndex: 1,
      wordLineIndex: 1,
      activeWordIndex: 1,
    });
  });

  it('is stable across ticks that land inside the same word', () => {
    // This is what lets the caller skip rebuilding state and markup: the word
    // tick fires far more often than the highlight actually moves.
    const first = selectSyncedHighlight(lookup, 1_320);
    const second = selectSyncedHighlight(lookup, 1_400);
    const third = selectSyncedHighlight(lookup, 1_480);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('agrees with the state builder about the active word', () => {
    // One selection pass backs both, so the cheap change check and the rendered
    // state can never disagree.
    for (const positionMs of [1_000, 1_350, 1_700, 2_100, 5_000, 5_800, 9_000]) {
      const highlight = selectSyncedHighlight(lookup, positionMs);
      const wordLine = highlight.wordLineIndex === -1 ? null : wordLines[highlight.wordLineIndex];
      const expected = wordLine ? selectActiveWordIndex(wordLine, positionMs) : -1;
      expect(highlight.activeWordIndex).toBe(expected);
    }
  });

  it('reports no word line when the lookup has no word timings', () => {
    expect(selectSyncedHighlight({ ...lookup, wordLines: [] }, 1_400)).toEqual({
      lineIndex: 0,
      wordLineIndex: -1,
      activeWordIndex: -1,
    });
  });
});
