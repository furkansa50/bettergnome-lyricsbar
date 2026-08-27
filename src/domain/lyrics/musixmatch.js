import { parseLrc } from './lrc.js';
import { wordLinesToLyricLines } from './ttml.js';

/**
 * @import {
 *   LyricsProviderResult,
 *   ProviderTrackInfo,
 *   WordTimedLyricLine,
 *   WordTiming,
 * } from './types.js'
 */

/**
 * Parse Musixmatch RichSync JSON data into a synchronized lyrics result
 * containing word-level timings.
 *
 * @param {unknown} richSyncData
 * @param {ProviderTrackInfo} track
 * @returns {LyricsProviderResult | null}
 */
export function parseMusixmatchRichSync(richSyncData, track) {
  if (!Array.isArray(richSyncData) || richSyncData.length === 0) {
    return null;
  }

  /** @type {WordTimedLyricLine[]} */
  const wordLines = [];

  for (const rawLine of richSyncData) {
    if (!rawLine || typeof rawLine !== 'object') {
      continue;
    }

    const ts = Reflect.get(rawLine, 'ts');
    const te = Reflect.get(rawLine, 'te');
    if (
      typeof ts !== 'number' ||
      typeof te !== 'number' ||
      !Number.isFinite(ts) ||
      !Number.isFinite(te)
    ) {
      continue;
    }

    const lineStartMs = Math.round(ts * 1000);
    const lineEndMs = Math.max(lineStartMs, Math.round(te * 1000));
    const rawTokens = Reflect.get(rawLine, 'l');

    /** @type {WordTiming[]} */
    const words = [];
    /** @type {{ beginMs: number, text: string, trailingSpace: boolean }[]} */
    const rawWords = [];

    if (Array.isArray(rawTokens)) {
      for (const rawToken of rawTokens) {
        if (!rawToken || typeof rawToken !== 'object') {
          continue;
        }

        const content = Reflect.get(rawToken, 'c');
        if (typeof content !== 'string') {
          continue;
        }

        // Empty token or whitespace-only token marks trailing whitespace on previous word
        if (content.trim() === '') {
          if (rawWords.length > 0) {
            const prev = rawWords[rawWords.length - 1];
            if (prev) {
              prev.trailingSpace = true;
            }
          }
          continue;
        }

        const offsetSec = Reflect.get(rawToken, 'o');
        const offset = typeof offsetSec === 'number' && Number.isFinite(offsetSec) ? offsetSec : 0;
        const beginMs = Math.round((ts + offset) * 1000);
        const hasTrailingSpace = /\s$/.test(content);
        const text = content.trim();

        if (text === '') {
          continue;
        }

        rawWords.push({
          beginMs,
          text,
          trailingSpace: hasTrailingSpace,
        });
      }

      for (let i = 0; i < rawWords.length; i++) {
        const curr = rawWords[i];
        if (!curr) {
          continue;
        }
        const next = rawWords[i + 1];
        const endMs = next ? Math.max(curr.beginMs, Math.min(lineEndMs, next.beginMs)) : lineEndMs;

        words.push(
          Object.freeze({
            beginMs: curr.beginMs,
            endMs,
            text: curr.text,
            trailingSpace: curr.trailingSpace,
          }),
        );
      }
    }

    const rawText = Reflect.get(rawLine, 'x');
    const text =
      typeof rawText === 'string' && rawText.trim() !== ''
        ? rawText.trim()
        : words
            .map((w) => w.text + (w.trailingSpace ? ' ' : ''))
            .join('')
            .trim();

    if (text === '') {
      continue;
    }

    wordLines.push(
      Object.freeze({
        timeMs: lineStartMs,
        endMs: lineEndMs,
        text,
        words: Object.freeze(words),
      }),
    );
  }

  if (wordLines.length === 0) {
    return null;
  }

  wordLines.sort((a, b) => a.timeMs - b.timeMs);
  const lines = wordLinesToLyricLines(wordLines);
  const plainText = lines.map((l) => l.text).join('\n');

  return Object.freeze({
    kind: 'synced',
    track: Object.freeze(track),
    lines: Object.freeze(lines),
    wordLines: Object.freeze(wordLines),
    plainText,
    source: 'Musixmatch',
  });
}

/**
 * Parse Musixmatch macro.subtitles.get API response body.
 *
 * Checks for RichSync (word-by-word synced) data first;
 * falls back to standard subtitle LRC if RichSync is not available.
 *
 * @param {string | unknown} body
 * @param {ProviderTrackInfo} track
 * @returns {LyricsProviderResult}
 */
export function parseMusixmatchResponse(body, track) {
  let parsed;
  if (typeof body === 'string') {
    if (body.trim() === '') {
      return Object.freeze({ kind: 'not-found' });
    }
    try {
      parsed = JSON.parse(body);
    } catch {
      return Object.freeze({ kind: 'error', reason: 'invalid json response' });
    }
  } else if (body && typeof body === 'object') {
    parsed = body;
  } else {
    return Object.freeze({ kind: 'not-found' });
  }

  const message = parsed?.message;
  if (!message || typeof message !== 'object') {
    return Object.freeze({ kind: 'not-found' });
  }

  const statusCode = message?.header?.status_code;
  if (statusCode !== 200) {
    if (statusCode === 404 || statusCode === 401) {
      return Object.freeze({ kind: 'not-found' });
    }
    if (statusCode === 429) {
      return Object.freeze({ kind: 'error', reason: 'rate limited' });
    }
    return Object.freeze({ kind: 'error', reason: `musixmatch status ${statusCode}` });
  }

  const macroCalls = message?.body?.macro_calls;
  if (!macroCalls || typeof macroCalls !== 'object') {
    return Object.freeze({ kind: 'not-found' });
  }

  // 1. Try RichSync (word-by-word)
  const richsyncCall = macroCalls['track.richsync.get'];
  if (richsyncCall?.message?.header?.status_code === 200) {
    const rawBody = richsyncCall?.message?.body?.richsync?.richsync_body;
    if (typeof rawBody === 'string' && rawBody.trim() !== '') {
      try {
        const richSyncJson = JSON.parse(rawBody);
        const richSyncResult = parseMusixmatchRichSync(richSyncJson, track);
        if (richSyncResult !== null) {
          return richSyncResult;
        }
      } catch {
        // Fall back to subtitle if richsync JSON parsing failed
      }
    } else if (Array.isArray(rawBody)) {
      const richSyncResult = parseMusixmatchRichSync(rawBody, track);
      if (richSyncResult !== null) {
        return richSyncResult;
      }
    }
  }

  // 2. Fall back to standard subtitle (line-by-line LRC)
  const subtitlesCall = macroCalls['track.subtitles.get'];
  if (subtitlesCall?.message?.header?.status_code === 200) {
    const subtitleList = subtitlesCall?.message?.body?.subtitle_list;
    const firstSubtitle = Array.isArray(subtitleList) ? subtitleList[0] : null;
    const lrcBody = firstSubtitle?.subtitle?.subtitle_body;
    if (typeof lrcBody === 'string' && lrcBody.trim() !== '') {
      const lines = parseLrc(lrcBody);
      if (lines.length > 0) {
        return Object.freeze({
          kind: 'synced',
          track: Object.freeze(track),
          lines: Object.freeze(lines),
          wordLines: Object.freeze([]),
          plainText: lines.map((l) => l.text).join('\n'),
          source: 'Musixmatch',
        });
      }
    }
  }

  return Object.freeze({ kind: 'not-found' });
}
