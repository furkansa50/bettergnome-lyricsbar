/**
 * @import { LyricsQuery } from '../../domain/lyrics/types.js'
 */

const UNISON_ENDPOINT = 'https://unison.boidu.dev/lyrics';
const BETTER_LYRICS_ENDPOINT = 'https://lyrics-api.boidu.dev/getLyrics';

/**
 * Build the Unison API URL for a lyrics query.
 *
 * @param {LyricsQuery} query
 * @returns {string | null}
 */
export function buildUnisonUrl(query) {
  const artist = normalize(query.artist);
  const title = normalize(query.title);
  if (artist === '' || title === '') {
    return null;
  }

  /** @type {[string, string][]} */
  const params = [
    ['song', title],
    ['artist', artist],
  ];

  const album = normalize(query.album);
  if (album !== '') {
    params.push(['album', album]);
  }

  if (
    typeof query.durationMs === 'number' &&
    Number.isFinite(query.durationMs) &&
    query.durationMs > 0
  ) {
    params.push(['duration', String(Math.round(query.durationMs / 1000))]);
  }

  return `${UNISON_ENDPOINT}?${encodeFormQuery(params)}`;
}

/**
 * Build the Better Lyrics API URL for a lyrics query.
 *
 * @param {LyricsQuery} query
 * @returns {string | null}
 */
export function buildBetterLyricsUrl(query) {
  const artist = normalize(query.artist);
  const title = normalize(query.title);
  if (artist === '' || title === '') {
    return null;
  }

  /** @type {[string, string][]} */
  const params = [
    ['s', title],
    ['a', artist],
  ];

  const album = normalize(query.album);
  if (album !== '') {
    params.push(['al', album]);
  }

  if (
    typeof query.durationMs === 'number' &&
    Number.isFinite(query.durationMs) &&
    query.durationMs > 0
  ) {
    params.push(['d', String(Math.round(query.durationMs / 1000))]);
  }

  return `${BETTER_LYRICS_ENDPOINT}?${encodeFormQuery(params)}`;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalize(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

/**
 * GJS does not expose browser URLSearchParams, so encode the query
 * shape directly using application/x-www-form-urlencoded spacing.
 *
 * @param {readonly (readonly [string, string])[]} params
 * @returns {string}
 */
function encodeFormQuery(params) {
  return params
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join('&');
}

/**
 * @param {string} value
 * @returns {string}
 */
function encodeFormComponent(value) {
  return encodeURIComponent(value).replaceAll("'", '%27').replaceAll('%20', '+');
}
