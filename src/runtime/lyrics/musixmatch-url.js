/**
 * Musixmatch moved to the signed web API: `apic-desktop.musixmatch.com` no
 * longer accepts anonymous tokens, while `www.musixmatch.com/ws/1.1/` accepts
 * logged-in web tokens when each request carries an HMAC-SHA256 `signature`
 * computed with a key shipped inside the website's own JS bundle.
 */

export const MUSIXMATCH_ORIGIN = 'https://www.musixmatch.com';
export const MUSIXMATCH_API_BASE = `${MUSIXMATCH_ORIGIN}/ws/1.1/`;
export const DEFAULT_APP_ID = 'mxm-com-v1.0';

/**
 * Build the musixmatch.com search page URL (the HTML that links the app JS
 * bundle which contains the request-signing key).
 *
 * @returns {string}
 */
export function buildSearchPageUrl() {
  return `${MUSIXMATCH_ORIGIN}/search`;
}

/**
 * Build the API URL for an endpoint. The signature must be computed over this
 * exact string, so the encoding has to stay byte-identical to the one the
 * website itself sends (URLSearchParams form encoding; GJS has no global
 * URLSearchParams, hence the manual serializer below).
 *
 * @param {string} endpoint
 * @param {Record<string, string>} params
 * @returns {string | null}
 */
export function buildMusixmatchApiUrl(endpoint, params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    parts.push(`${formUrlEncode(key)}=${formUrlEncode(value)}`);
  }
  return `${MUSIXMATCH_API_BASE}${endpoint}?${parts.join('&')}`;
}

/**
 * application/x-www-form-urlencoded serializer, byte-identical to
 * `new URLSearchParams(...).toString()`: space becomes '+', everything outside
 * [A-Za-z0-9*-._] is percent-encoded (uppercase hex, UTF-8 bytes).
 *
 * @param {string} value
 * @returns {string}
 */
function formUrlEncode(value) {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9*\-._]/.test(ch)) {
      out += ch;
    } else if (ch === ' ') {
      out += '+';
    } else {
      for (const byte of new TextEncoder().encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

/**
 * Find the app JS bundle URL in the search page HTML (last `_app-` chunk wins).
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractAppScriptUrl(html) {
  const matches = [
    ...html.matchAll(/src="([^"]*\/_next\/static\/chunks\/pages\/_app-[^"]+\.js)"/g),
  ];
  const path = matches.at(-1)?.[1];
  if (typeof path !== 'string' || path === '') {
    return null;
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${MUSIXMATCH_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Extract the (reversed, base64-encoded) signing key from the app JS bundle.
 *
 * @param {string} appJs
 * @returns {string | null}
 */
export function extractSigningSecretEncoded(appJs) {
  const match = /from\(\s*"(.*?)"\s*\.split/.exec(appJs);
  return match?.[1] ?? null;
}

/**
 * Extract the app version (used as `x-mxm-app-version`) from the bundle URL.
 *
 * @param {string} appUrl
 * @returns {string | null}
 */
export function extractAppVersion(appUrl) {
  return /\/prod\/([\d.]+)\//.exec(appUrl)?.[1] ?? null;
}

/**
 * Reverses and base64-decodes the extracted key into its plaintext form.
 * GJS has no global atob, hence the manual decoder.
 *
 * @param {string} encoded
 * @returns {string | null}
 */
export function decodeSigningSecret(encoded) {
  const reversed = [...encoded].reverse().join('');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Map([...alphabet].map((ch, index) => [ch, index]));
  /** @type {number[]} */
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of reversed) {
    if (ch === '=') {
      break;
    }
    const value = lookup.get(ch);
    if (value === undefined) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
