import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { parseTtml, wordLinesToLyricLines } from '../../domain/lyrics/ttml.js';
import { buildBetterLyricsUrl } from './better-lyrics-url.js';
import { LrclibProvider } from './lrclib.js';
import { MusixmatchProvider } from './musixmatch.js';

/**
 * @import { LifecycleRegistry } from '../lifecycle.js'
 * @import { RuntimeLogger } from '../logger.js'
 * @import { LyricsProviderResult, LyricsQuery } from '../../domain/lyrics/types.js'
 *
 * @typedef {(result: LyricsProviderResult) => void} LyricsLookupCallback
 */

const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT = 'betterlyricsbar/1.1.0 (+https://github.com/furkansa50/bettergnome-lyricsbar)';

export class BetterLyricsProvider {
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

  /** @type {LrclibProvider} */
  #lrclibProvider;

  /** @type {MusixmatchProvider} */
  #musixmatchProvider;

  /** @type {() => import('../../domain/settings/types.js').LyricsSource} */
  #getLyricsSource;

  /**
   * In-flight HTTP requests. Tracked in one set instead of registering a
   * lifecycle cleanup per request, which would grow the registry unbounded
   * across track changes.
   *
   * @type {Set<{ cancellable: any, cancelTimeout: () => void }>}
   */
  #inflight = new Set();

  /**
   * @param {LifecycleRegistry} lifecycle
   * @param {{ session?: any, timeoutMs?: number, logger?: RuntimeLogger | undefined, getLyricsSource?: () => import('../../domain/settings/types.js').LyricsSource }} [options]
   */
  constructor(lifecycle, options = {}) {
    this.#lifecycle = lifecycle;
    this.#timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#logger = options.logger ?? null;
    this.#getLyricsSource = options.getLyricsSource ?? (() => 'musixmatch');

    if (options.session) {
      this.#session = options.session;
    } else {
      this.#session = new Soup.Session({
        user_agent: USER_AGENT,
        timeout: Math.max(1, Math.round(this.#timeoutMs / 1000)),
      });
    }

    this.#lrclibProvider = new LrclibProvider(this.#lifecycle, {
      session: this.#session,
      timeoutMs: this.#timeoutMs,
      logger: this.#logger ? this.#logger.child('lrclib') : undefined,
    });

    this.#musixmatchProvider = new MusixmatchProvider(this.#lifecycle, {
      session: this.#session,
      timeoutMs: this.#timeoutMs,
      logger: this.#logger ? this.#logger.child('musixmatch') : undefined,
    });

    this.#lifecycle.add(() => {
      this.#logger?.debug('provider-dispose');
      this.#enabled = false;
      this.#abortInflight();
      try {
        this.#session?.abort?.();
      } catch {
        // session already cleaned up; ignore
      }
      this.#session = null;
    });
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
   * Lookup lyrics.
   *
   * Provider order depends on the `lyrics-source` setting:
   *   - `'musixmatch'` (default): Musixmatch (RichSync/LRC) → Better Lyrics → LRCLIB.
   *     Musixmatch is checked first for word-level RichSync; Better Lyrics is
   *     queried next; LRCLIB is the final fallback for line-by-line synced lyrics.
   *   - `'better-lyrics'`: Better Lyrics API → Musixmatch only (no LRCLIB).
   *   - `'lrclib'`: LRCLIB only.
   *
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @returns {void}
   */
  lookup(query, callback) {
    if (!this.#enabled) {
      this.#logger?.debug('lookup-skipped', { reason: 'provider-disabled' });
      callback(Object.freeze({ kind: 'error', reason: 'provider disabled' }));
      return;
    }

    const source = this.#getLyricsSource();
    if (source === 'lrclib') {
      this.#logger?.debug('lookup-lrclib-only');
      this.#lrclibProvider.lookup(query, callback);
      return;
    }

    if (source === 'better-lyrics') {
      this.#logger?.debug('lookup-better-lyrics-first');
      this.#lookupBetterLyrics(query, callback, false);
      return;
    }

    // Default: musixmatch — full chain: Musixmatch → Better Lyrics → LRCLIB.
    this.#logger?.debug('lookup-musixmatch-first');
    this.#lookupMusixmatchFirst(query, callback);
  }

  /**
   * Default chain: Musixmatch → Better Lyrics → LRCLIB.
   *
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @returns {void}
   */
  #lookupMusixmatchFirst(query, callback) {
    this.#logger?.debug('musixmatch-request-start', {
      artist: query.artist,
      title: query.title,
    });

    this.#musixmatchProvider.lookup(query, (result) => {
      if (!this.#enabled) {
        return;
      }

      this.#logger?.debug('musixmatch-result', { kind: result.kind });
      if (result.kind === 'synced' || result.kind === 'plain') {
        callback(result);
        return;
      }

      // Musixmatch miss → try Better Lyrics next, then LRCLIB.
      this.#lookupBetterLyrics(query, callback, true);
    });
  }

  /**
   * Try the Better Lyrics API. On a miss, fall back to Musixmatch.
   *
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @param {boolean} allowLrclibFallback
   * @returns {void}
   */
  #lookupBetterLyrics(query, callback, allowLrclibFallback) {
    const url = buildBetterLyricsUrl(query);
    if (url === null) {
      this.#lookupMusixmatch(query, callback, allowLrclibFallback);
      return;
    }

    this.#logger?.debug('better-lyrics-request-start', {
      artist: query.artist,
      title: query.title,
    });

    this.#send(url, (httpResult) => {
      if (!this.#enabled) {
        return;
      }

      const result = this.#parseBetterLyricsResponse(httpResult, query);
      this.#logger?.debug('better-lyrics-result', {
        kind: result.kind,
        statusCode: httpResult.statusCode ?? null,
      });

      if (result.kind === 'synced' || result.kind === 'plain') {
        callback(result);
        return;
      }

      // Better Lyrics miss (404 / 401 / not-found / error) -> try Musixmatch next.
      this.#lookupMusixmatch(query, callback, allowLrclibFallback);
    });
  }

  /**
   * Try Musixmatch for word-level RichSync or synced lyrics.
   * On a miss, fall back to LRCLIB when allowed.
   *
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @param {boolean} allowLrclibFallback
   * @returns {void}
   */
  #lookupMusixmatch(query, callback, allowLrclibFallback) {
    this.#logger?.debug('musixmatch-request-start', {
      artist: query.artist,
      title: query.title,
    });

    this.#musixmatchProvider.lookup(query, (result) => {
      if (!this.#enabled) {
        return;
      }

      this.#logger?.debug('musixmatch-result', { kind: result.kind });
      if (result.kind === 'synced' || result.kind === 'plain') {
        callback(result);
        return;
      }

      this.#fallbackToLrclib(query, callback, allowLrclibFallback);
    });
  }

  /**
   * @param {LyricsQuery} query
   * @param {LyricsLookupCallback} callback
   * @param {boolean} allowLrclibFallback
   * @returns {void}
   */
  #fallbackToLrclib(query, callback, allowLrclibFallback) {
    if (allowLrclibFallback) {
      this.#logger?.debug('fallback-to-lrclib');
      this.#lrclibProvider.lookup(query, callback);
      return;
    }
    callback(Object.freeze({ kind: 'not-found' }));
  }

  /**
   * Parse Better Lyrics API response. Returns:
   *   success: { ttml: "<TTML string>", score: 0.95 }
   *   error:   { error: "..." }  with status 404/429/500
   *
   * @param {{ statusCode?: number | null, body?: string | null, error?: string | null }} result
   * @param {LyricsQuery} query
   * @returns {LyricsProviderResult}
   */
  #parseBetterLyricsResponse(result, query) {
    if (result.error) {
      return Object.freeze({ kind: 'error', reason: result.error });
    }

    const status = result.statusCode;
    if (status === null || status === undefined) {
      return Object.freeze({ kind: 'error', reason: 'missing http status' });
    }

    if (status === 404) {
      return Object.freeze({ kind: 'not-found' });
    }

    // 401 means the track is not cached and the API requires an X-API-Key for
    // a fresh fetch. From the caller's perspective the public API has no
    // lyrics for this query, so treat it as a miss and let the fallback chain
    // (Musixmatch -> LRCLIB) take over.
    if (status === 401) {
      return Object.freeze({ kind: 'not-found' });
    }

    if (status === 429) {
      return Object.freeze({ kind: 'error', reason: 'rate limited' });
    }

    if (status < 200 || status >= 300) {
      return Object.freeze({ kind: 'error', reason: `status ${status}` });
    }

    const { body } = result;
    if (typeof body !== 'string' || body === '') {
      return Object.freeze({ kind: 'error', reason: 'empty response body' });
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (parseError) {
      return Object.freeze({
        kind: 'error',
        reason: `invalid json: ${describeError(parseError)}`,
      });
    }

    if (!parsed || typeof parsed.ttml !== 'string' || parsed.ttml.trim() === '') {
      return Object.freeze({ kind: 'not-found' });
    }

    const ttmlResult = this.#parseTtmlToResult(parsed.ttml, {
      trackName: query.title,
      artistName: query.artist,
      albumName: query.album,
      durationMs: query.durationMs,
    });

    return ttmlResult ?? Object.freeze({ kind: 'not-found' });
  }

  /**
   * Parse TTML content and produce a LyricsProviderResult.
   *
   * @param {string} ttml
   * @param {import('../../domain/lyrics/types.js').ProviderTrackInfo} track
   * @returns {LyricsProviderResult | null}
   */
  #parseTtmlToResult(ttml, track) {
    const wordLines = parseTtml(ttml);
    if (wordLines.length === 0) {
      return null;
    }

    const lines = wordLinesToLyricLines(wordLines);
    const plainText = lines.map((l) => l.text).join('\n');

    return Object.freeze({
      kind: 'synced',
      track: Object.freeze(track),
      lines: Object.freeze(lines),
      wordLines: Object.freeze(wordLines),
      plainText,
      source: 'Better Lyrics',
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
      this.#logger?.debug('lookup-skipped', { reason: 'invalid-url' });
      callback(Object.freeze({ statusCode: null, body: null, error: 'invalid lookup url' }));
      return;
    }

    this.#logger?.debug('request-send');

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
        // already removed when the timeout fired
      }
    };

    // Track the request so disable() can cancel it. Registering per-request
    // lifecycle entries would leak one entry per lookup for the whole session.
    const entry = { cancellable, cancelTimeout };
    this.#inflight.add(entry);

    const headers = message.get_request_headers?.();
    headers?.append?.('User-Agent', USER_AGENT);

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
