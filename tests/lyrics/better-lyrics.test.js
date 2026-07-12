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
