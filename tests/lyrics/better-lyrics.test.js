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

  it('queries Better Lyrics API and Musixmatch but does NOT fall back to LRCLIB when lyricsSource is "better-lyrics"', () => {
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

    expect(sentUrls[0]).toContain('lyrics-api.boidu.dev');
    expect(sentUrls.some((url) => url.includes('apic-desktop.musixmatch.com'))).toBe(true);
    expect(sentUrls.some((url) => url.includes('lrclib.net'))).toBe(false);
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });

  it('queries Musixmatch -> Better Lyrics -> LRCLIB when lyricsSource is "musixmatch" (default)', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'musixmatch',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);

    expect(sentUrls.some((url) => url.includes('apic-desktop.musixmatch.com'))).toBe(true);
    expect(sentUrls.some((url) => url.includes('lyrics-api.boidu.dev'))).toBe(true);
    expect(sentUrls.some((url) => url.includes('lrclib.net'))).toBe(true);
    expect(callback).toHaveBeenCalledWith({ kind: 'not-found' });
  });

  it('prewarms Musixmatch token when lyricsSource is "musixmatch"', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'musixmatch',
    });

    provider.prewarm();
    expect(sentUrls).toHaveLength(1);
    expect(sentUrls[0]).toContain('token.get');
  });

  it('does not prewarm Musixmatch token when lyricsSource is "lrclib"', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = createMockSession(sentUrls);

    const lifecycle = new LifecycleRegistry();
    const provider = new BetterLyricsProvider(lifecycle, {
      session: mockSession,
      getLyricsSource: () => 'lrclib',
    });

    provider.prewarm();
    expect(sentUrls).toHaveLength(0);
  });
});

describe('BetterLyricsProvider hits', () => {
  const query = {
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    durationMs: 266000,
  };

  const sampleTtml = `
    <p begin="1.000" end="2.000">
      <span begin="1.000" end="1.400">Look</span>
      <span begin="1.400" end="2.000">at</span>
    </p>
    <p begin="2.000" end="4.000">the stars</p>
  `;

  it('returns TTML synced result for a Better Lyrics hit', () => {
    /** @type {string[]} */
    const sentUrls = [];
    const mockSession = {
      /**
       * @param {{ url: string }} message
       * @param {unknown} _priority
       * @param {unknown} _cancellable
       * @param {(error: unknown, response: unknown) => void} callback
       */
      send_and_read_async: (message, _priority, _cancellable, callback) => {
        sentUrls.push(message.url);
        Reflect.set(message, 'get_status', () => 200);
        callback(null, {
          get_data: () =>
            new TextEncoder().encode(JSON.stringify({ ttml: sampleTtml, score: 0.9 })),
        });
      },
      /**
       * @param {unknown} result
       */
      send_and_read_finish: (result) => result,
    };

    const provider = new BetterLyricsProvider(new LifecycleRegistry(), {
      session: mockSession,
      getLyricsSource: () => 'better-lyrics',
    });

    const callback = vi.fn();
    provider.lookup(query, callback);

    expect(sentUrls).toHaveLength(1);
    expect(sentUrls[0]).toContain('lyrics-api.boidu.dev');

    const result = callback.mock.calls[0]?.[0];
    expect(result.kind).toBe('synced');
    expect(result.lines).toEqual([
      { timeMs: 1000, text: 'Look at' },
      { timeMs: 2000, text: 'the stars' },
    ]);
    expect(result.wordLines).toHaveLength(2);
    expect(result.source).toBe('Better Lyrics');
  });
});
