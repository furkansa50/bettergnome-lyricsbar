/**
 * @import { LyricsQuery } from '../../domain/lyrics/types.js'
 */

const MUSIXMATCH_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1/';

/**
 * Build the Musixmatch token URL to obtain a desktop app session/user token.
 *
 * @returns {string}
 */
export function buildMusixmatchTokenUrl() {
  /** @type {[string, string][]} */
  const params = [
    ['user_language', 'en'],
    ['app_id', 'web-desktop-app-v1.0'],
  ];

  return `${MUSIXMATCH_BASE}token.get?${encodeFormQuery(params)}`;
}

/**
 * Build the Musixmatch macro.subtitles.get URL for a lyrics query.
 *
 * @param {LyricsQuery} query
 * @param {string} userToken
 * @returns {string | null}
 */
export function buildMusixmatchMacroUrl(query, userToken) {
  const artist = normalize(query.artist);
  const title = normalize(query.title);
  if (artist === '' || title === '' || !userToken) {
    return null;
  }

  /** @type {[string, string][]} */
  const params = [
    ['usertoken', userToken],
    ['app_id', 'web-desktop-app-v1.0'],
    ['format', 'json'],
    ['q_artist', artist],
    ['q_track', title],
    ['namespace', 'lyrics_richsynched'],
    ['optional_calls', 'track.richsync'],
  ];

  const album = normalize(query.album);
  if (album !== '') {
    params.push(['q_album', album]);
  }

  if (
    typeof query.durationMs === 'number' &&
    Number.isFinite(query.durationMs) &&
    query.durationMs > 0
  ) {
    params.push(['q_duration', String(Math.round(query.durationMs / 1000))]);
  }

  return `${MUSIXMATCH_BASE}macro.subtitles.get?${encodeFormQuery(params)}`;
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
