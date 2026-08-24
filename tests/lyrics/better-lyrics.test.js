import { describe, expect, it, vi } from 'vitest';

vi.mock('gi://Gio', () => ({
  default: {
    Cancellable: class {
      cancel() {}
      is_cancelled() {
        return false;
      }
    },
  },
}));

vi.mock('gi://GLib', () => ({
  default: {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    timeout_add: () => 1,
    source_remove: () => {},
  },
}));

vi.mock('gi://Soup', () => ({
  default: {
    Session: class {},
    Message: {
      /**
       * @param {string} method
       * @param {string} url
       */
      new: (method, url) => ({
        method,
        url,
        status_code: 404,
        get_status: () => 404,
        get_request_headers: () => ({ append: () => {} }),
      }),
    },
  },
}));

import { BetterLyricsProvider } from '../../src/runtime/lyrics/better-lyrics.js';
import { LifecycleRegistry } from '../../src/runtime/lifecycle.js';

describe('BetterLyricsProvider source switching', () => {
  const query = {
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    durationMs: 266000,
  };

  /**
   * @param {string[]} sentUrls
   */
  const createMockSession = (sentUrls) => ({
    /**
     * @param {{ url: string }} message
     * @param {unknown} _priority
     * @param {unknown} _cancellable
     * @param {(error: unknown, response: unknown) => void} callback
     */
    send_and_read_async: (message, _priority, _cancellable, callback) => {
      sentUrls.push(message.url);
      callback(null, {
        get_status: () => 404,
        get_data: () => new TextEncoder().encode('Not Found'),
      });
    },
    /**
     * @param {unknown} result
     */
    send_and_read_finish: (result) => result,
  });

  it('queries only LRCLIB when lyricsSource is "lrclib"', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'lrclib',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);

    expect(sentUrls).toHaveLength(2);
    expect(sentUrls[0]).toContain('lrclib.net');
    expect(sentUrls[1]).toContain('lrclib.net');
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });

  it('queries Unison and Better Lyrics API but does NOT fall back to LRCLIB when lyricsSource is "better-lyrics"', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'better-lyrics',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);

    expect(sentUrls).toHaveLength(2);
    expect(sentUrls[0]).toContain('unison.boidu.dev');
    expect(sentUrls[1]).toContain('lyrics-api.boidu.dev');
    expect(sentUrls.some((url) => url.includes('lrclib.net'))).toBe(false);
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });

  it('queries Unison -> Better Lyrics API -> falls back to LRCLIB when lyricsSource is "auto"', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'auto',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);

    expect(sentUrls).toHaveLength(4);
    expect(sentUrls[0]).toContain('unison.boidu.dev');
    expect(sentUrls[1]).toContain('lyrics-api.boidu.dev');
    expect(sentUrls[2]).toContain('lrclib.net');
    expect(sentUrls[3]).toContain('lrclib.net');
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });
});

describe('BetterLyricsProvider Unison responses', () => {
  const query = {
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    durationMs: 266000,
  };

  const unisonTtml = `
    <p begin="1.000" end="2.000">
      <span begin="1.000" end="1.400">Look</span>
      <span begin="1.400" end="2.000">at</span>
    </p>
    <p begin="2.000" end="4.000">the stars</p>
  `;

  /**
   * A session that answers the first request with `body` and 200, and every
   * later request (the fallback chain) with 404.
   *
   * @param {string} body
   * @param {string[]} sentUrls
   */
  const createUnisonSession = (body, sentUrls) => ({
    /**
     * @param {{ url: string }} message
     * @param {unknown} _priority
     * @param {unknown} _cancellable
     * @param {(error: unknown, response: unknown) => void} callback
     */
    send_and_read_async: (message, _priority, _cancellable, callback) => {
      const isFirst = sentUrls.length === 0;
      sentUrls.push(message.url);
      const status = isFirst ? 200 : 404;
      Reflect.set(message, 'get_status', () => status);
      callback(null, {
        get_data: () => new TextEncoder().encode(isFirst ? body : 'Not Found'),
      });
    },
    /**
     * @param {unknown} result
     */
    send_and_read_finish: (result) => result,
  });

  /**
   * @param {string} body
   */
  const lookupWithUnisonBody = (body) => {
    /** @type {string[]} */
    const sentUrls = [];
    const provider = new BetterLyricsProvider(new LifecycleRegistry(), {
      session: createUnisonSession(body, sentUrls),
      getLyricsSource: () => 'auto',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);
    return { callback, sentUrls };
  };

  it('reports the queried track for a Unison TTML hit', () => {
    const { callback, sentUrls } = lookupWithUnisonBody(
      JSON.stringify({ success: true, lyrics: unisonTtml }),
    );

    // A hit must short-circuit the rest of the chain.
    expect(sentUrls).toHaveLength(1);
    expect(sentUrls[0]).toContain('unison.boidu.dev');

    const result = callback.mock.calls[0]?.[0];
    expect(result.kind).toBe('synced');
    // Unison echoes no metadata, so the track has to come from the query.
    // Downstream sync policies reject positions beyond track duration, which
    // needs a real durationMs rather than null.
    expect(result.track).toEqual({
      trackName: 'Yellow',
      artistName: 'Coldplay',
      albumName: 'Parachutes',
      durationMs: 266000,
    });
    expect(result.lines).toEqual([
      { timeMs: 1000, text: 'Look at' },
      { timeMs: 2000, text: 'the stars' },
    ]);
    expect(result.wordLines).toHaveLength(2);
  });

  it('accepts a Unison payload that is LRC rather than TTML', () => {
    const { callback, sentUrls } = lookupWithUnisonBody(
      JSON.stringify({ success: true, lyrics: '[00:01.00]Look at the stars\n[00:04.00]And all' }),
    );

    expect(sentUrls).toHaveLength(1);

    const result = callback.mock.calls[0]?.[0];
    expect(result.kind).toBe('synced');
    expect(result.lines).toEqual([
      { timeMs: 1000, text: 'Look at the stars' },
      { timeMs: 4000, text: 'And all' },
    ]);
    // LRC carries no word timing, so word highlight is disabled for this track.
    expect(result.wordLines).toEqual([]);
    expect(result.plainText).toBe('Look at the stars\nAnd all');
    expect(result.track.durationMs).toBe(266000);
  });

  it('falls through the chain when Unison reports failure', () => {
    const { callback, sentUrls } = lookupWithUnisonBody(
      JSON.stringify({ success: false, error: 'not found', code: 'NOT_FOUND' }),
    );

    expect(sentUrls).toHaveLength(4);
    expect(sentUrls[1]).toContain('lyrics-api.boidu.dev');
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });

  it('falls through the chain when the Unison payload has no usable timings', () => {
    const { callback, sentUrls } = lookupWithUnisonBody(
      JSON.stringify({ success: true, lyrics: 'Look at the stars' }),
    );

    expect(sentUrls).toHaveLength(4);
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });
});
