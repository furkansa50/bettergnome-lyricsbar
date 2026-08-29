import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { parseMusixmatchResponse } from '../../domain/lyrics/musixmatch.js';
import { buildMusixmatchTokenUrl, buildMusixmatchMacroUrl } from './musixmatch-url.js';

/**
 * @import { LifecycleRegistry } from '../lifecycle.js'
 * @import { RuntimeLogger } from '../logger.js'
 * @import { LyricsProviderResult, LyricsQuery, ProviderTrackInfo } from '../../domain/lyrics/types.js'
 *
 * @typedef {(result: LyricsProviderResult) => void} LyricsLookupCallback
 */

const DEFAULT_TIMEOUT_MS = 5000;
const MUSIXMATCH_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Musixmatch/0.19.4 Chrome/58.0.3029.110 Electron/1.7.6 Safari/537.36';

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

  /** @type {string | null} */
  #userToken = null;

  /**
   * In-flight token fetch callback queue.
   *
   * @type {((token: string | null) => void)[] | null}
   */
  #tokenWaiters = null;

  /**
   * In-flight HTTP requests.
   *
   * @type {Set<{ cancellable: any, cancelTimeout: () => void }>}
   */
  #inflight = new Set();

  /**
   * @param {LifecycleRegistry} lifecycle
   * @param {{ session?: any, timeoutMs?: number, logger?: RuntimeLogger | undefined }} [options]
   */
  constructor(lifecycle, options = {}) {
    this.#lifecycle = lifecycle;
    this.#timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger ?? null;

    if (options.session) {
      this.#session = options.session;
    } else {
      this.#session = new Soup.Session({
        user_agent: MUSIXMATCH_USER_AGENT,
        timeout: Math.max(1, Math.round(this.#timeoutMs / 1000)),
      });
    }

    this.#lifecycle.add(() => {
      this.#logger?.debug('musixmatch-provider-dispose');
      this.#enabled = false;
      this.#abortInflight();
      this.#tokenWaiters = null;
      try {
        this.#session?.abort?.();
      } catch {
        // already cleaned up; ignore
      }
      this.#session = null;
    });

    this.#userToken = readCachedToken();
    if (this.#userToken) {
      this.#logger?.debug('musixmatch-token-loaded-from-cache');
    }
  }

  /**
   * Pre-warm the anonymous user token in the background so it is ready
   * before the first lyric lookup is triggered.
   *
   * @returns {void}
   */
  prewarm() {
    if (!this.#enabled || this.#userToken !== null) {
      return;
    }
    this.#logger?.debug('musixmatch-token-prewarm');
    this.#ensureUserToken(() => {});
  }

  /**
   * Cancel every in-flight request and drop its timeout source.
   *
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

  /**
   * Lookup lyrics on Musixmatch.
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

    this.#ensureUserToken((token) => {
      if (!this.#enabled) {
        return;
      }

      if (!token) {
        this.#logger?.debug('musixmatch-token-failed');
        callback(Object.freeze({ kind: 'not-found' }));
        return;
      }

      this.#performLookup(query, token, callback, false);
    });
  }

  /**
   * @param {LyricsQuery} query
   * @param {string} token
   * @param {LyricsLookupCallback} callback
   * @param {boolean} isRetry
   * @returns {void}
   */
  #performLookup(query, token, callback, isRetry) {
    const url = buildMusixmatchMacroUrl(query, token);
    if (url === null) {
      callback(Object.freeze({ kind: 'not-found' }));
      return;
    }

    this.#logger?.debug('musixmatch-request-start', {
      title: query.title,
      artist: query.artist,
    });

    this.#send(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }

      if (httpResult.error) {
        this.#logger?.debug('musixmatch-error', { reason: httpResult.error });
        callback(Object.freeze({ kind: 'error', reason: httpResult.error }));
        return;
      }

      // If token expired (401), clear and retry once
      if (httpResult.statusCode === 401 && !isRetry) {
        this.#logger?.debug('musixmatch-token-expired');
        this.#userToken = null;
        deleteCachedToken();
        this.#ensureUserToken((freshToken) => {
          if (!this.#enabled || !freshToken) {
            callback(Object.freeze({ kind: 'not-found' }));
            return;
          }
          this.#performLookup(query, freshToken, callback, true);
        });
        return;
      }

      /** @type {ProviderTrackInfo} */
      const track = {
        trackName: query.title,
        artistName: query.artist,
        albumName: query.album,
        durationMs: query.durationMs,
      };

      const result = parseMusixmatchResponse(httpResult.body ?? '', track);
      this.#logger?.debug('musixmatch-result', { kind: result.kind });
      callback(result);
    });
  }

  /**
   * Retrieve a cached token or fetch a new one.
   *
   * @param {(token: string | null) => void} onToken
   * @returns {void}
   */
  #ensureUserToken(onToken) {
    if (this.#userToken !== null) {
      onToken(this.#userToken);
      return;
    }

    if (this.#tokenWaiters !== null) {
      this.#tokenWaiters.push(onToken);
      return;
    }

    this.#tokenWaiters = [onToken];
    const url = buildMusixmatchTokenUrl();

    this.#send(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }

      let fetchedToken = null;
      if (httpResult.statusCode === 200 && typeof httpResult.body === 'string') {
        try {
          const parsed = JSON.parse(httpResult.body);
          const tokenCandidate = parsed?.message?.body?.user_token;
          if (
            typeof tokenCandidate === 'string' &&
            tokenCandidate !== '' &&
            !tokenCandidate.includes('UpgradeOnly')
          ) {
            fetchedToken = tokenCandidate;
          }
        } catch {
          // invalid JSON
        }
      }

      this.#userToken = fetchedToken;
      if (fetchedToken !== null) {
        writeCachedToken(fetchedToken);
      }
      const waiters = this.#tokenWaiters ?? [];
      this.#tokenWaiters = null;

      for (const waiter of waiters) {
        waiter(fetchedToken);
      }
    });
  }

  /**
   * @param {string} url
   * @param {(result: { statusCode?: number | null, body?: string | null, error?: string | null }) => void} callback
   * @returns {void}
   */
  #send(url, callback) {
    const message = Soup.Message.new('GET', url);
    if (message === null) {
      callback(Object.freeze({ statusCode: null, body: null, error: 'invalid lookup url' }));
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
    headers?.append?.('User-Agent', MUSIXMATCH_USER_AGENT);
    headers?.append?.('Cookie', 'AWSELB=0; AWSELBCORS=0');

    const session = this.#session;
    session.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      /**
       * @param {unknown} _source
       * @param {unknown} result
       * @returns {void}
       */
      (_source, result) => {
        this.#inflight.delete(entry);
        cancelTimeout();

        if (!this.#enabled || cancellable.is_cancelled?.() === true) {
          if (timedOut) {
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
}

/**
 * @param {unknown} bytes
 * @returns {string}
 */
function readBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  const candidate = /** @type {{ get_data?: unknown, toArray?: unknown }} */ (bytes);
  if (typeof candidate.get_data === 'function') {
    const raw = /** @type {{ get_data: () => unknown }} */ (candidate).get_data();
    if (raw === null || raw === undefined) {
      return '';
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(/** @type {Uint8Array} */ (raw));
  }
  return String(bytes);
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

/**
 * @returns {string | null}
 */
function readCachedToken() {
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
    const tokenFile = GLib.build_filenamev([userCacheDir, 'lyricbar', 'musixmatch-token.json']);
    const [ok, contents] = GLib.file_get_contents(tokenFile);
    if (!ok || !contents) {
      return null;
    }
    const decoder = new TextDecoder('utf-8');
    const raw = readBytes(contents);
    const parsed = JSON.parse(raw || decoder.decode(/** @type {Uint8Array} */ (contents)));
    if (
      typeof parsed?.token === 'string' &&
      parsed.token !== '' &&
      !parsed.token.includes('UpgradeOnly')
    ) {
      return parsed.token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @returns {void}
 */
function writeCachedToken(token) {
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
    const tokenFile = GLib.build_filenamev([dir, 'musixmatch-token.json']);
    const payload = JSON.stringify({ token, savedAt: Date.now() });
    const encoder = new TextEncoder();
    GLib.file_set_contents(tokenFile, encoder.encode(payload));
  } catch {
    // Silently ignore write failures
  }
}

/**
 * @returns {void}
 */
function deleteCachedToken() {
  try {
    if (typeof GLib?.get_user_cache_dir !== 'function' || typeof GLib?.unlink !== 'function') {
      return;
    }
    const userCacheDir = GLib.get_user_cache_dir();
    if (!userCacheDir) {
      return;
    }
    const tokenFile = GLib.build_filenamev([userCacheDir, 'lyricbar', 'musixmatch-token.json']);
    GLib.unlink(tokenFile);
  } catch {
    // Silently ignore
  }
}
