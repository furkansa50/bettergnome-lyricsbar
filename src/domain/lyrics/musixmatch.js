import { parseLrc } from './lrc.js';

/**
 * @import {
 *   LyricsProviderResult,
 *   LyricsQuery,
 *   ProviderTrackInfo,
 * } from './types.js'
 */

/**
 * Musixmatch's honeypot/fallback tracks: the matcher sometimes returns these
 * regardless of the query, so they must never be picked.
 * 115264642: Coldplay - Paradise
 * 226291677: Drake - NOKIA (dummy lyrics)
 */
const HONEYPOT_TRACK_IDS = new Set([115264642, 226291677]);

// How far (in seconds) a Musixmatch track's duration may differ from the query.
const DURATION_TOLERANCE_S = 10;

/**
 * Musixmatch embeds lyrics as HTML-escaped text (named and numeric entities).
 * Undecoded numeric entities are the "garbled text" reported for CJK lyrics.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeMusixmatchText(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => codePointToString(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => codePointToString(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * @param {number} codePoint
 * @returns {string}
 */
function codePointToString(codePoint) {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return '';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}

/**
 * Extract the candidate track list from a signed `track.search` response.
 *
 * @param {unknown} body
 * @returns {MusixmatchTrack[]}
 */
export function parseMusixmatchSearchResponse(body) {
  const message = readObject(body, 'message');
  const header = readObject(message, 'header');
  if (readNumber(header, 'status_code') !== 200) {
    return [];
  }
  const responseBody = readObject(message, 'body');
  const trackList = readArray(responseBody, 'track_list');
  if (trackList === null) {
    return [];
  }

  /** @type {MusixmatchTrack[]} */
  const tracks = [];
  for (const entry of trackList) {
    const track = readObject(readObject(entry, 'track'), '');
    if (track === null || typeof readNumber(track, 'track_id') !== 'number') {
      continue;
    }
    tracks.push({
      trackId: /** @type {number} */ (readNumber(track, 'track_id')),
      trackName: readString(track, 'track_name'),
      artistName: readString(track, 'artist_name'),
      trackLength: readNumber(track, 'track_length'),
      instrumental: readNumber(track, 'instrumental') === 1,
      hasLyrics: readNumber(track, 'has_lyrics') === 1,
      hasSubtitles: readNumber(track, 'has_subtitles') === 1,
    });
  }
  return tracks;
}

/**
 * Pick the best Musixmatch track for a query: skip honeypots and
 * instrumentals, require actual lyric data, prefer synced subtitles, then the
 * closest duration.
 *
 * @param {MusixmatchTrack[]} tracks
 * @param {LyricsQuery} query
 * @returns {MusixmatchTrack | null}
 */
export function pickMusixmatchTrack(tracks, query) {
  const durationS =
    typeof query.durationMs === 'number' &&
    Number.isFinite(query.durationMs) &&
    query.durationMs > 0
      ? Math.round(query.durationMs / 1000)
      : null;

  const candidates = tracks
    .filter((track) => !HONEYPOT_TRACK_IDS.has(track.trackId))
    .filter((track) => !track.instrumental)
    .filter((track) => track.hasLyrics || track.hasSubtitles)
    .map((track) => ({
      track,
      diff:
        durationS !== null && typeof track.trackLength === 'number' && track.trackLength > 0
          ? Math.abs(track.trackLength - durationS)
          : 0,
    }))
    .filter(({ diff }) => diff <= DURATION_TOLERANCE_S);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (a, b) => Number(b.track.hasSubtitles) - Number(a.track.hasSubtitles) || a.diff - b.diff,
  );
  return candidates[0]?.track ?? null;
}

/**
 * Parse a `track.subtitles.get` response (LRC body) into a synced result.
 *
 * @param {unknown} body
 * @param {ProviderTrackInfo} track
 * @returns {LyricsProviderResult | null}
 */
export function parseMusixmatchSubtitleResponse(body, track) {
  const message = readObject(body, 'message');
  const header = readObject(message, 'header');
  const statusCode = readNumber(header, 'status_code');
  if (statusCode === 401 || statusCode === 403) {
    return Object.freeze({ kind: 'error', reason: 'musixmatch auth rejected' });
  }
  if (statusCode !== 200) {
    return null;
  }

  const responseBody = readObject(message, 'body');
  const subtitleList = readArray(responseBody, 'subtitle_list');
  const first = Array.isArray(subtitleList) ? subtitleList[0] : null;
  const subtitle = readObject(first, 'subtitle');
  const lrcBody = readString(subtitle, 'subtitle_body');
  if (lrcBody === '' || readNumber(subtitle, 'restricted') === 1) {
    return null;
  }

  const lines = parseLrc(
    lrcBody
      .split('\n')
      .map((line) => decodeMusixmatchText(line))
      .join('\n'),
  );
  if (lines.length === 0) {
    return null;
  }

  return Object.freeze({
    kind: 'synced',
    track: Object.freeze(track),
    lines: Object.freeze(lines),
    wordLines: Object.freeze([]),
    plainText: lines.map((l) => l.text).join('\n'),
    source: 'Musixmatch',
  });
}

/**
 * Parse a `track.lyrics.get` response into a plain (unsynced) result.
 *
 * @param {unknown} body
 * @param {ProviderTrackInfo} track
 * @returns {LyricsProviderResult | null}
 */
export function parseMusixmatchLyricsResponse(body, track) {
  const message = readObject(body, 'message');
  const header = readObject(message, 'header');
  const statusCode = readNumber(header, 'status_code');
  if (statusCode === 401 || statusCode === 403) {
    return Object.freeze({ kind: 'error', reason: 'musixmatch auth rejected' });
  }
  if (statusCode !== 200) {
    return null;
  }

  const lyrics = readObject(readObject(message, 'body'), 'lyrics');
  if (readNumber(lyrics, 'instrumental') === 1) {
    return Object.freeze({ kind: 'instrumental', track: Object.freeze(track) });
  }
  const lyricsBody = readString(lyrics, 'lyrics_body');
  if (lyricsBody === '') {
    return null;
  }

  const text = lyricsBody
    .split('\n')
    .map((line) => decodeMusixmatchText(line))
    .filter((line) => !/This Lyrics is NOT for Commercial use/i.test(line))
    .join('\n')
    .trim();
  if (text === '') {
    return null;
  }

  return Object.freeze({
    kind: 'plain',
    track: Object.freeze(track),
    text,
    source: 'Musixmatch',
  });
}

/**
 * @typedef {Readonly<{
 *   trackId: number,
 *   trackName: string,
 *   artistName: string,
 *   trackLength: number | null,
 *   instrumental: boolean,
 *   hasLyrics: boolean,
 *   hasSubtitles: boolean,
 * }>} MusixmatchTrack
 */

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {Record<string, unknown> | null}
 */
function readObject(value, key) {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  if (key === '') {
    return /** @type {Record<string, unknown>} */ (value);
  }
  const child = /** @type {Record<string, unknown>} */ (value)[key];
  if (child === null || typeof child !== 'object' || Array.isArray(child)) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (child);
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown[] | null}
 */
function readArray(value, key) {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const child = /** @type {Record<string, unknown>} */ (value)[key];
  return Array.isArray(child) ? child : null;
}

/**
 * @param {Record<string, unknown> | null} bag
 * @param {string} key
 * @returns {number | null}
 */
function readNumber(bag, key) {
  if (bag === null) {
    return null;
  }
  const value = bag[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {Record<string, unknown> | null} bag
 * @param {string} key
 * @returns {string}
 */
function readString(bag, key) {
  if (bag === null) {
    return '';
  }
  const value = bag[key];
  return typeof value === 'string' ? value : '';
}
