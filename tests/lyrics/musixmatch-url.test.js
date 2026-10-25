import { describe, expect, it } from 'vitest';

import {
  buildMusixmatchApiUrl,
  decodeSigningSecret,
  extractAppScriptUrl,
  extractAppVersion,
  extractSigningSecretEncoded,
} from '../../src/runtime/lyrics/musixmatch-url.js';

describe('buildMusixmatchApiUrl', () => {
  it('builds a signed-API URL with URLSearchParams-compatible encoding', () => {
    expect(
      buildMusixmatchApiUrl('track.search', {
        app_id: 'mxm-com-v1.0',
        q_track: '晴天',
        q_artist: '周杰伦',
        format: 'json',
      }),
    ).toBe(
      'https://www.musixmatch.com/ws/1.1/track.search' +
        '?app_id=mxm-com-v1.0&q_track=%E6%99%B4%E5%A4%A9&q_artist=%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json',
    );
  });

  it('encodes spaces as + and reserved characters like URLSearchParams', () => {
    expect(buildMusixmatchApiUrl('track.search', { q_track: 'a b (Live) & more!' })).toBe(
      'https://www.musixmatch.com/ws/1.1/track.search?q_track=a+b+%28Live%29+%26+more%21',
    );
  });

  it('percent-encodes apostrophes but keeps asterisks literal per the form-urlencoded set', () => {
    expect(buildMusixmatchApiUrl('track.search', { q_track: "don't *stop*" })).toBe(
      'https://www.musixmatch.com/ws/1.1/track.search?q_track=don%27t+*stop*',
    );
  });
});

describe('extractAppScriptUrl', () => {
  it('returns the last _app chunk URL', () => {
    const html = [
      '<script src="https://s.mxmcdn.net/mxm-com/prod/1.42.2/_next/static/chunks/pages/_app-old.js"></script>',
      '<script src="https://s.mxmcdn.net/mxm-com/prod/1.42.2/_next/static/chunks/pages/other.js"></script>',
      '<script src="https://s.mxmcdn.net/mxm-com/prod/1.42.2/_next/static/chunks/pages/_app-d98a875d017694f5.js"></script>',
    ].join('\n');
    expect(extractAppScriptUrl(html)).toBe(
      'https://s.mxmcdn.net/mxm-com/prod/1.42.2/_next/static/chunks/pages/_app-d98a875d017694f5.js',
    );
  });

  it('resolves relative chunk paths against the site origin', () => {
    const html = '<script src="/_next/static/chunks/pages/_app-abc.js"></script>';
    expect(extractAppScriptUrl(html)).toBe(
      'https://www.musixmatch.com/_next/static/chunks/pages/_app-abc.js',
    );
  });

  it('returns null when no app chunk is present', () => {
    expect(extractAppScriptUrl('<html><body>Not Found</body></html>')).toBeNull();
  });
});

describe('extractSigningSecretEncoded / decodeSigningSecret', () => {
  it('round-trips the reversed base64 key', () => {
    // base64("secret-key-0123456789abcdef") reversed, as shipped in the bundle
    const secret = 'secret-key-0123456789abcdef';
    const encoded = [...Buffer.from(secret, 'utf-8').toString('base64')].reverse().join('');
    const extracted = extractSigningSecretEncoded(
      `x=Buffer.from("${encoded}".split("").reverse())`,
    );
    expect(extracted).toBe(encoded);
    expect(decodeSigningSecret(/** @type {string} */ (extracted))).toBe(secret);
  });

  it('returns null when the bundle shape changed', () => {
    expect(extractSigningSecretEncoded('const x = 1;')).toBeNull();
    expect(decodeSigningSecret('!!!not base64!!!')).toBeNull();
  });
});

describe('extractAppVersion', () => {
  it('reads the prod version from the bundle URL', () => {
    expect(
      extractAppVersion(
        'https://s.mxmcdn.net/mxm-com/prod/1.42.2/_next/static/chunks/pages/_app-abc.js',
      ),
    ).toBe('1.42.2');
  });

  it('returns null for non-prod URLs', () => {
    expect(
      extractAppVersion('https://www.musixmatch.com/_next/static/chunks/pages/_app-abc.js'),
    ).toBeNull();
  });
});
