import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {
  parseMusixmatchLyricsResponse,
  parseMusixmatchSearchResponse,
  parseMusixmatchSubtitleResponse,
  pickMusixmatchTrack,
} from '../../domain/lyrics/musixmatch.js';
import {
  DEFAULT_APP_ID,
  MUSIXMATCH_ORIGIN,
  buildMusixmatchApiUrl,
  buildSearchPageUrl,
  decodeSigningSecret,
  extractAppScriptUrl,
  extractAppVersion,
  extractSigningSecretEncoded,
} from './musixmatch-url.js';

/**
 * @import { LifecycleRegistry } from '../lifecycle.js'
 * @import { RuntimeLogger } from '../logger.js'
 * @import { LyricsProviderResult, LyricsQuery, ProviderTrackInfo } from '../../domain/lyrics/types.js'
 *
 * @typedef {(result: LyricsProviderResult) => void} LyricsLookupCallback
 */

const DEFAULT_TIMEOUT_MS = 20000;
// The signing key is shipped inside musixmatch.com's JS bundle and rotates;
// cache it for a few hours before fetching a fresh one.
const SECRET_TTL_MS = 6 * 60 * 60 * 1000;

// The site serves its JS to plain browsers; the extension must look like one.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * @typedef {Readonly<{
 *   secret: string,
 *   version: string | null,
 *   savedAt: number,
 * }>} SigningSecret
 */

export class MusixmatchProvider {
  /** @type {any} */
  #session;

  /** @type {LifecycleRegistry} */
  #lifecycle;

  /** @type {boolean} */
  #enabled = true;

  /** @type {number} */
  #timeoutMs;

  /** @type {RuntimeLogger | null} */
  #logger = null;

  /** @type {() => string} */
  #getMusixmatchToken;

  /** @type {SigningSecret | null} */
  #secret;

  /**
   * In-flight secret load callback queue.
   *
   * @type {((ok: boolean) => void)[] | null}
   */
  #secretWaiters = null;

  /**
   * In-flight HTTP requests.
   *
   * @type {Set<{ cancellable: any, cancelTimeout: () => void }>}
   */
  #inflight = new Set();

  /**
   * @param {LifecycleRegistry} lifecycle
   * @param {{
   *   session?: any,
   *   timeoutMs?: number,
   *   logger?: RuntimeLogger | undefined,
   *   getMusixmatchToken?: () => string,
   * }} [options]
   */
  constructor(lifecycle, options = {}) {
    this.#lifecycle = lifecycle;
    this.#timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger ?? null;
    this.#getMusixmatchToken = options.getMusixmatchToken ?? (() => '');

    if (options.session) {
      this.#session = options.session;
    } else {
      // Own session: requests go to www.musixmatch.com with a browser UA and
      // need more headroom than the shared 5s session (JS bundle is ~3MB).
      this.#session = new Soup.Session({
        user_agent: BROWSER_USER_AGENT,
        timeout: Math.max(1, Math.round(this.#timeoutMs / 1000)),
      });
    }

    this.#lifecycle.add(() => {
      this.#logger?.debug('musixmatch-provider-dispose');
      this.#enabled = false;
      this.#abortInflight();
      this.#secretWaiters = null;
      try {
        this.#session?.abort?.();
      } catch {
        // already cleaned up; ignore
      }
      this.#session = null;
    });

    this.#secret = readCachedSecret();
    if (this.#secret) {
      this.#logger?.debug('musixmatch-secret-loaded-from-cache');
    }
  }

  /**
   * Pre-warm the request-signing key so the first lookup does not pay for the
   * search page + JS bundle round trip.
   *
   * @returns {void}
   */
  prewarm() {
    if (!this.#enabled || this.#getMusixmatchToken() === '') {
      return;
    }
    this.#logger?.debug('musixmatch-secret-prewarm');
    this.#ensureSecret(() => {});
  }

  /**
   * Lookup lyrics on Musixmatch's signed web API.
   *
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @returns {void}
   */
  lookup(query, callback) {
    if (!this.#enabled) {
      callback(Object.freeze({ kind: 'error', reason: 'provider disabled' }));
      return;
    }

    const token = this.#getMusixmatchToken();
    if (token === '') {
      // Anonymous tokens are no longer issued; without a login token the
      // provider simply yields to the next source in the chain.
      this.#logger?.debug('musixmatch-token-missing');
      callback(Object.freeze({ kind: 'not-found' }));
      return;
    }

    this.#ensureSecret((ok) => {
      if (!this.#enabled) {
        return;
      }
      if (!ok) {
        this.#logger?.debug('musixmatch-secret-failed');
        callback(
          Object.freeze({
            kind: 'error',
            reason: 'musixmatch init failed (network or site layout changed)',
          }),
        );
        return;
      }
      this.#performLookup(query, token, callback, false);
    });
  }

  /**
   * @param {LyricsQuery} query
   * @param {string} token
   * @param {LyricsLookupCallback} callback
   * @param {boolean} authRetried
   * @returns {void}
   */
  #performLookup(query, token, callback, authRetried) {
    // NOTE: no q_duration here — musixmatch applies it as a hard filter that
    // zeroes out otherwise correct results; duration is scored locally when
    // picking the candidate instead.
    const searchParams = {
      app_id: DEFAULT_APP_ID,
      format: 'json',
      usertoken: token,
      q_track: query.title,
      q_artist: query.artist,
      f_has_lyrics: 'true',
      s_track_rating: 'desc',
      page_size: '10',
      page: '1',
    };

    const url = buildMusixmatchApiUrl('track.search', searchParams);
    if (url === null) {
      callback(Object.freeze({ kind: 'not-found' }));
      return;
    }

    this.#logger?.debug('musixmatch-request-start', {
      title: query.title,
      artist: query.artist,
    });

    this.#sendSigned(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }

      if (httpResult.error) {
        this.#logger?.debug('musixmatch-error', { reason: httpResult.error });
        callback(Object.freeze({ kind: 'error', reason: httpResult.error }));
        return;
      }

      let parsed = /** @type {any} */ (null);
      try {
        parsed = JSON.parse(httpResult.body ?? '');
      } catch {
        callback(Object.freeze({ kind: 'error', reason: 'invalid json response' }));
        return;
      }

      if (
        httpResult.statusCode === 401 ||
        httpResult.statusCode === 403 ||
        isAuthRejected(parsed)
      ) {
        this.#handleAuthRejection(token, query, callback, authRetried, () => {
          this.#performLookup(query, token, callback, true);
        });
        return;
      }

      const tracks = parseMusixmatchSearchResponse(parsed);
      const track = pickMusixmatchTrack(tracks, query);
      if (track === null) {
        this.#logger?.debug('musixmatch-no-track', { candidates: tracks.length });
        callback(Object.freeze({ kind: 'not-found' }));
        return;
      }

      const /** @type {ProviderTrackInfo} */ trackInfo = {
          trackName: track.trackName || query.title,
          artistName: track.artistName || query.artist,
          albumName: query.album,
          durationMs: query.durationMs,
        };

      if (track.hasSubtitles) {
        this.#fetchSubtitle(token, track.trackId, trackInfo, callback, authRetried);
        return;
      }
      if (track.hasLyrics) {
        this.#fetchLyrics(token, track.trackId, trackInfo, callback, authRetried);
        return;
      }
      callback(Object.freeze({ kind: 'not-found' }));
    });
  }

  /**
   * @param {string} token
   * @param {number} trackId
   * @param {ProviderTrackInfo} trackInfo
   * @param {LyricsLookupCallback} callback
   * @param {boolean} authRetried
   * @returns {void}
   */
  #fetchSubtitle(token, trackId, trackInfo, callback, authRetried) {
    const url = buildMusixmatchApiUrl('track.subtitles.get', {
      app_id: DEFAULT_APP_ID,
      format: 'json',
      usertoken: token,
      track_id: String(trackId),
      subtitle_format: 'lrc',
    });
    if (url === null) {
      callback(Object.freeze({ kind: 'not-found' }));
      return;
    }

    this.#sendSigned(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }
      if (httpResult.error) {
        this.#logger?.debug('musixmatch-error', { reason: httpResult.error });
        callback(Object.freeze({ kind: 'error', reason: httpResult.error }));
        return;
      }

      let parsed = /** @type {any} */ (null);
      try {
        parsed = JSON.parse(httpResult.body ?? '');
      } catch {
        callback(Object.freeze({ kind: 'error', reason: 'invalid json response' }));
        return;
      }

      if (
        httpResult.statusCode === 401 ||
        httpResult.statusCode === 403 ||
        isAuthRejected(parsed)
      ) {
        this.#handleAuthRejection(token, null, callback, authRetried, () => {
          this.#fetchSubtitle(token, trackId, trackInfo, callback, true);
        });
        return;
      }

      const result = parseMusixmatchSubtitleResponse(parsed, trackInfo);
      this.#logger?.debug('musixmatch-result', { kind: result?.kind ?? 'none' });
      callback(result ?? Object.freeze({ kind: 'not-found' }));
    });
  }

  /**
   * @param {string} token
   * @param {number} trackId
   * @param {ProviderTrackInfo} trackInfo
   * @param {LyricsLookupCallback} callback
   * @param {boolean} authRetried
   * @returns {void}
   */
  #fetchLyrics(token, trackId, trackInfo, callback, authRetried) {
    const url = buildMusixmatchApiUrl('track.lyrics.get', {
      app_id: DEFAULT_APP_ID,
      format: 'json',
      usertoken: token,
      track_id: String(trackId),
    });
    if (url === null) {
      callback(Object.freeze({ kind: 'not-found' }));
      return;
    }

    this.#sendSigned(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }
      if (httpResult.error) {
        this.#logger?.debug('musixmatch-error', { reason: httpResult.error });
        callback(Object.freeze({ kind: 'error', reason: httpResult.error }));
        return;
      }

      let parsed = /** @type {any} */ (null);
      try {
        parsed = JSON.parse(httpResult.body ?? '');
      } catch {
        callback(Object.freeze({ kind: 'error', reason: 'invalid json response' }));
        return;
      }

      if (
        httpResult.statusCode === 401 ||
        httpResult.statusCode === 403 ||
        isAuthRejected(parsed)
      ) {
        this.#handleAuthRejection(token, null, callback, authRetried, () => {
          this.#fetchLyrics(token, trackId, trackInfo, callback, true);
        });
        return;
      }

      const result = parseMusixmatchLyricsResponse(parsed, trackInfo);
      this.#logger?.debug('musixmatch-result', { kind: result?.kind ?? 'none' });
      callback(result ?? Object.freeze({ kind: 'not-found' }));
    });
  }

  /**
   * Auth rejections (401/403) can come from a rotated signing key OR a bad
   * login token. Refresh the key once and retry; a persistent rejection is a
   * token problem the user has to fix.
   *
   * @param {string} _token
   * @param {LyricsQuery | null} _query
   * @param {LyricsLookupCallback} callback
   * @param {boolean} authRetried
   * @param {() => void} retry
   * @returns {void}
   */
  #handleAuthRejection(_token, _query, callback, authRetried, retry) {
    if (authRetried) {
      this.#logger?.debug('musixmatch-auth-rejected');
      callback(
        Object.freeze({
          kind: 'error',
          reason: 'musixmatch auth rejected (check login token)',
        }),
      );
      return;
    }
    this.#logger?.debug('musixmatch-auth-retry');
    this.#loadSecret(true, (ok) => {
      if (!this.#enabled) {
        return;
      }
      if (!ok) {
        callback(
          Object.freeze({
            kind: 'error',
            reason: 'musixmatch auth rejected (key refresh failed)',
          }),
        );
        return;
      }
      retry();
    });
  }

  /**
   * @param {(ok: boolean) => void} onReady
   * @returns {void}
   */
  #ensureSecret(onReady) {
    if (this.#secret && Date.now() - this.#secret.savedAt < SECRET_TTL_MS) {
      onReady(true);
      return;
    }
    this.#loadSecret(false, onReady);
  }

  /**
   * @param {boolean} force
   * @param {(ok: boolean) => void} onReady
   * @returns {void}
   */
  #loadSecret(force, onReady) {
    if (this.#secretWaiters !== null) {
      this.#secretWaiters.push(onReady);
      return;
    }
    if (!force && this.#secret && Date.now() - this.#secret.savedAt < SECRET_TTL_MS) {
      onReady(true);
      return;
    }

    this.#secretWaiters = [onReady];
    const finish = (/** @type {boolean} */ ok) => {
      const waiters = this.#secretWaiters ?? [];
      this.#secretWaiters = null;
      for (const waiter of waiters) {
        waiter(ok);
      }
    };

    this.#send(buildSearchPageUrl(), { cookie: 'mxm_bab=AB' }, (pageResult) => {
      if (!this.#enabled) {
        return;
      }
      if (pageResult.error || typeof pageResult.body !== 'string') {
        this.#logger?.debug('musixmatch-secret-page-failed', {
          reason: pageResult.error ?? 'empty body',
        });
        finish(false);
        return;
      }

      const appUrl = extractAppScriptUrl(pageResult.body);
      if (appUrl === null) {
        this.#logger?.debug('musixmatch-secret-app-script-not-found');
        finish(false);
        return;
      }

      this.#send(appUrl, {}, (jsResult) => {
        if (!this.#enabled) {
          return;
        }
        if (jsResult.error || typeof jsResult.body !== 'string') {
          this.#logger?.debug('musixmatch-secret-bundle-failed', {
            reason: jsResult.error ?? 'empty body',
          });
          finish(false);
          return;
        }

        const encoded = extractSigningSecretEncoded(jsResult.body);
        const secret = encoded === null ? null : decodeSigningSecret(encoded);
        if (encoded === null || secret === null || secret === '') {
          this.#logger?.debug('musixmatch-secret-key-not-found');
          finish(false);
          return;
        }

        const version = extractAppVersion(appUrl);
        this.#secret = Object.freeze({ secret, version, savedAt: Date.now() });
        writeCachedSecret(this.#secret);
        this.#logger?.debug('musixmatch-secret-loaded', { version });
        finish(true);
      });
    });
  }

  /**
   * Append the HMAC-SHA256 signature to an API URL and send it.
   *
   * @param {string} url
   * @param {(result: { statusCode?: number | null, body?: string | null, error?: string | null }) => void} callback
   * @returns {void}
   */
  #sendSigned(url, callback) {
    const secret = this.#secret;
    if (!secret) {
      callback(Object.freeze({ statusCode: null, body: null, error: 'signing key not loaded' }));
      return;
    }

    const signature = signMusixmatchUrl(url, secret.secret);
    if (signature === null) {
      callback(Object.freeze({ statusCode: null, body: null, error: 'signing failed' }));
      return;
    }

    this.#send(
      `${url}&signature=${encodeURIComponent(signature)}&signature_protocol=sha256`,
      {
        referer: `${MUSIXMATCH_ORIGIN}/`,
        appVersion: secret.version,
      },
      callback,
    );
  }

  /**
   * @param {string} url
   * @param {{ cookie?: string, referer?: string, appVersion?: string | null }} extraHeaders
   * @param {(result: { statusCode?: number | null, body?: string | null, error?: string | null }) => void} callback
   * @returns {void}
   */
  #send(url, extraHeaders, callback) {
    const message = Soup.Message.new('GET', url);
    if (message === null) {
      callback(Object.freeze({ statusCode: null, body: null, error: 'invalid request url' }));
      return;
    }

    const cancellable = new Gio.Cancellable();
    const timeoutMs = this.#timeoutMs;
    let timedOut = false;
    /** @type {number} */
    let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
      timedOut = true;
      timeoutId = 0;
      try {
        cancellable.cancel();
      } catch {
        // already cancelled
      }
      return GLib.SOURCE_REMOVE;
    });

    const cancelTimeout = () => {
      if (timeoutId === 0) {
        return;
      }
      const id = timeoutId;
      timeoutId = 0;
      try {
        GLib.source_remove(id);
      } catch {
        // already removed
      }
    };

    const entry = { cancellable, cancelTimeout };
    this.#inflight.add(entry);

    const headers = message.get_request_headers?.();
    if (typeof extraHeaders.cookie === 'string') {
      headers?.append?.('Cookie', extraHeaders.cookie);
    }
    if (typeof extraHeaders.referer === 'string') {
      headers?.append?.('Referer', extraHeaders.referer);
    }
    if (typeof extraHeaders.appVersion === 'string' && extraHeaders.appVersion !== '') {
      headers?.append?.('x-mxm-app-version', extraHeaders.appVersion);
    }

    const session = this.#session;
    session.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      /** @param {unknown} _source @param {unknown} result */
      (_source, result) => {
        this.#inflight.delete(entry);
        cancelTimeout();

        if (!this.#enabled || cancellable.is_cancelled?.() === true) {
          if (timedOut) {
            this.#logger?.debug('request-timeout');
            callback(Object.freeze({ statusCode: null, body: null, error: 'request timed out' }));
          }
          return;
        }

        let body;
        try {
          const bytes = session.send_and_read_finish(result);
          body = readBytes(bytes);
        } catch (error) {
          callback(
            Object.freeze({
              statusCode: null,
              body: null,
              error: describeError(error),
            }),
          );
          return;
        }

        const statusCode = readStatusCode(message);
        callback({ statusCode, body });
      },
    );
  }

  /**
   * @returns {void}
   */
  #abortInflight() {
    for (const entry of [...this.#inflight]) {
      this.#inflight.delete(entry);
      entry.cancelTimeout();
      try {
        entry.cancellable.cancel();
      } catch {
        // already cancelled
      }
    }
  }
}

/**
 * HMAC-SHA256 of `url + local YYYYMMDD` with the site's signing key,
 * base64-encoded (same scheme musixmatch.com's own frontend uses).
 *
 * @param {string} url
 * @param {string} secret
 * @returns {string | null}
 */
function signMusixmatchUrl(url, secret) {
  const now = new Date();
  const date =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`;

  try {
    const encoder = new TextEncoder();
    const key = encoder.encode(secret);
    const data = encoder.encode(url + date);
    const hex = GLib.compute_hmac_for_data(GLib.ChecksumType.SHA256, key, data);
    const digest = hexToBytes(hex);
    if (digest === null) {
      return null;
    }
    return GLib.base64_encode(digest);
  } catch {
    return null;
  }
}

/**
 * @param {string} hex
 * @returns {number[] | null}
 */
function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    return null;
  }
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(byte)) {
      return null;
    }
    bytes.push(byte);
  }
  return bytes;
}

/**
 * @param {any} parsed
 * @returns {boolean}
 */
function isAuthRejected(parsed) {
  const statusCode = parsed?.message?.header?.status_code;
  return statusCode === 401 || statusCode === 403;
}

/**
 * @returns {SigningSecret | null}
 */
function readCachedSecret() {
  try {
    if (
      typeof GLib?.get_user_cache_dir !== 'function' ||
      typeof GLib?.file_get_contents !== 'function'
    ) {
      return null;
    }
    const userCacheDir = GLib.get_user_cache_dir();
    if (!userCacheDir) {
      return null;
    }
    const secretFile = GLib.build_filenamev([userCacheDir, 'lyricbar', 'musixmatch-secret.json']);
    const [ok, contents] = GLib.file_get_contents(secretFile);
    if (!ok || !contents) {
      return null;
    }
    const parsed = JSON.parse(readBytes(contents));
    if (
      typeof parsed?.secret === 'string' &&
      parsed.secret !== '' &&
      typeof parsed?.savedAt === 'number'
    ) {
      return Object.freeze({
        secret: parsed.secret,
        version: typeof parsed.version === 'string' ? parsed.version : null,
        savedAt: parsed.savedAt,
      });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {SigningSecret} secret
 * @returns {void}
 */
function writeCachedSecret(secret) {
  try {
    if (
      typeof GLib?.get_user_cache_dir !== 'function' ||
      typeof GLib?.file_set_contents !== 'function'
    ) {
      return;
    }
    const userCacheDir = GLib.get_user_cache_dir();
    if (!userCacheDir) {
      return;
    }
    const dir = GLib.build_filenamev([userCacheDir, 'lyricbar']);
    if (typeof GLib.mkdir_with_parents === 'function') {
      GLib.mkdir_with_parents(dir, 0o755);
    }
    const secretFile = GLib.build_filenamev([dir, 'musixmatch-secret.json']);
    const payload = JSON.stringify({
      secret: secret.secret,
      version: secret.version,
      savedAt: secret.savedAt,
    });
    GLib.file_set_contents(secretFile, new TextEncoder().encode(payload));
  } catch {
    // Silently ignore write failures
  }
}

/**
 * @param {unknown} bytes
 * @returns {string}
 */
function readBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  // GLib.file_get_contents returns a Uint8Array; Soup returns GBytes.
  if (bytes instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  const candidate = /** @type {{ get_data?: unknown, toArray?: unknown }} */ (bytes);
  if (typeof candidate.get_data === 'function') {
    const raw = /** @type {{ get_data: () => unknown }} */ (candidate).get_data();
    if (raw === null || raw === undefined) {
      return '';
    }
    return new TextDecoder('utf-8').decode(/** @type {Uint8Array} */ (raw));
  }
  if (typeof candidate.toArray === 'function') {
    return new TextDecoder('utf-8').decode(candidate.toArray());
  }
  return '';
}

/**
 * @param {any} message
 * @returns {number | null}
 */
function readStatusCode(message) {
  if (!message) {
    return null;
  }
  const status = message.get_status?.() ?? message.status_code ?? null;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeError(value) {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}
