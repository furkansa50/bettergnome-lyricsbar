const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/**
 * @import { LyricLine } from './types.js'
 */

/**
 * @param {string} input
 * @returns {LyricLine[]}
 */
export function parseLrc(input) {
  if (input.trim() === '') {
    return [];
  }

  /** @type {LyricLine[]} */
  const lines = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(TIMESTAMP_PATTERN)];
    if (timestamps.length === 0) {
      continue;
    }

    const text = rawLine.replace(TIMESTAMP_PATTERN, '').trim();
    if (text === '') {
      continue;
    }

    for (const timestamp of timestamps) {
      const timeMs = parseTimestampMs(timestamp);
      if (timeMs === null) {
        continue;
      }

      lines.push({ timeMs, text });
    }
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs);
}

/**
 * @param {readonly LyricLine[]} lines
 * @param {number} positionMs
 * @returns {LyricLine | null}
 */
export function selectLyricLine(lines, positionMs) {
  const index = selectLyricLineIndex(lines, positionMs);
  return index === -1 ? null : (lines[index] ?? null);
}

/**
 * Index of the active line, or -1 when none applies.
 *
 * Callers that need to highlight one row of a full lyrics list must use the
 * index: matching on line text highlights every repeat of a chorus.
 *
 * @param {readonly LyricLine[]} lines
 * @param {number} positionMs
 * @returns {number}
 */
export function selectLyricLineIndex(lines, positionMs) {
  if (lines.length === 0) {
    return -1;
  }

  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return -1;
  }

  return lastIndexAtOrBefore(lines, positionMs, readLineTimeMs);
}

/**
 * Index of the last entry whose start time is at or before `positionMs`, or -1.
 *
 * Entries must be sorted ascending by start time, which every producer here
 * guarantees. Binary search keeps the cost independent of song length: this runs
 * on the word-highlight tick, far more often than once per lyric line. With
 * several entries sharing a start time the last of them wins, matching the
 * "latest applicable line" rule callers rely on.
 *
 * @template T
 * @param {readonly T[]} entries
 * @param {number} positionMs
 * @param {(entry: T) => number | undefined} readStartMs
 * @returns {number}
 */
export function lastIndexAtOrBefore(entries, positionMs, readStartMs) {
  let low = 0;
  let high = entries.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = entries[middle];
    const startMs = entry === undefined ? undefined : readStartMs(entry);
    if (typeof startMs !== 'number' || startMs > positionMs) {
      high = middle - 1;
      continue;
    }
    found = middle;
    low = middle + 1;
  }

  return found;
}

/**
 * @param {LyricLine} line
 * @returns {number}
 */
function readLineTimeMs(line) {
  return line.timeMs;
}

/**
 * @param {RegExpMatchArray} match
 * @returns {number | null}
 */
function parseTimestampMs(match) {
  const rawMinutes = match[1];
  const rawSeconds = match[2];
  if (rawMinutes === undefined || rawSeconds === undefined) {
    return null;
  }

  const minutes = Number.parseInt(rawMinutes, 10);
  const seconds = Number.parseInt(rawSeconds, 10);
  const fraction = match[3] ?? '0';

  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || seconds > 59) {
    return null;
  }

  const fractionMs = parseFractionMs(fraction);
  return (minutes * 60 + seconds) * 1000 + fractionMs;
}

/**
 * @param {string} value
 * @returns {number}
 */
function parseFractionMs(value) {
  if (value.length === 1) {
    return Number.parseInt(value, 10) * 100;
  }

  if (value.length === 2) {
    return Number.parseInt(value, 10) * 10;
  }

  return Number.parseInt(value.slice(0, 3), 10);
}
