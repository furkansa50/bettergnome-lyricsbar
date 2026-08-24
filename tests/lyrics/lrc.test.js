import { describe, expect, it } from 'vitest';

import { parseLrc, selectLyricLine, selectLyricLineIndex } from '../../src/domain/lyrics/lrc.js';

describe('parseLrc', () => {
  it('parses timestamped lyric lines', () => {
    const lines = parseLrc('[00:01.20]First line\n[00:03.45]Second line');

    expect(lines).toEqual([
      { timeMs: 1200, text: 'First line' },
      { timeMs: 3450, text: 'Second line' },
    ]);
  });

  it('supports multiple timestamps for one lyric line', () => {
    const lines = parseLrc('[00:01.00][00:02.00]Repeat');

    expect(lines).toEqual([
      { timeMs: 1000, text: 'Repeat' },
      { timeMs: 2000, text: 'Repeat' },
    ]);
  });

  it('ignores metadata and empty lyric rows', () => {
    const lines = parseLrc('[ar:Artist]\n[00:01.00]\n[00:02.00]Line');

    expect(lines).toEqual([{ timeMs: 2000, text: 'Line' }]);
  });
});

describe('selectLyricLine', () => {
  it('returns the latest line at or before the playback position', () => {
    const lines = parseLrc('[00:01.00]One\n[00:02.00]Two\n[00:03.00]Three');

    expect(selectLyricLine(lines, 2500)).toEqual({ timeMs: 2000, text: 'Two' });
  });

  it('returns null before the first line', () => {
    const lines = parseLrc('[00:01.00]One');

    expect(selectLyricLine(lines, 500)).toBeNull();
  });
});

describe('selectLyricLineIndex', () => {
  it('returns the index of the latest line at or before the position', () => {
    const lines = parseLrc('[00:01.00]One\n[00:02.00]Two\n[00:03.00]Three');

    expect(selectLyricLineIndex(lines, 2500)).toBe(1);
  });

  it('returns -1 before the first line', () => {
    const lines = parseLrc('[00:01.00]One');

    expect(selectLyricLineIndex(lines, 500)).toBe(-1);
  });

  it('returns -1 for an empty list', () => {
    expect(selectLyricLineIndex([], 5000)).toBe(-1);
  });

  it('returns -1 for an unusable position', () => {
    const lines = parseLrc('[00:01.00]One');

    expect(selectLyricLineIndex(lines, -1)).toBe(-1);
    expect(selectLyricLineIndex(lines, Number.NaN)).toBe(-1);
  });

  it('distinguishes repeated lines so a chorus highlights only once', () => {
    const lines = parseLrc('[00:01.00]Chorus\n[00:05.00]Verse\n[00:10.00]Chorus\n[00:15.00]Outro');

    expect(selectLyricLineIndex(lines, 11000)).toBe(2);
  });

  it('agrees with selectLyricLine', () => {
    const lines = parseLrc('[00:01.00]A\n[00:02.00]B\n[00:03.00]C');
    const index = selectLyricLineIndex(lines, 2500);

    expect(index).toBe(1);
    expect(lines[index]).toEqual(selectLyricLine(lines, 2500));
  });
});
