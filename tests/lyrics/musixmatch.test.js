import { describe, expect, it } from 'vitest';

import {
  decodeMusixmatchText,
  parseMusixmatchLyricsResponse,
  parseMusixmatchSearchResponse,
  parseMusixmatchSubtitleResponse,
  pickMusixmatchTrack,
} from '../../src/domain/lyrics/musixmatch.js';

const track = {
  trackName: 'Hello',
  artistName: 'Adele',
  albumName: '25',
  durationMs: 295000,
};

/**
 * @param {Record<string, unknown>} overrides
 * @returns {unknown}
 */
const searchResponse = (overrides) => ({
  message: {
    header: { status_code: 200 },
    body: {
      track_list: [
        {
          track: {
            track_id: 1,
            track_name: 'Hello',
            artist_name: 'Adele',
            track_length: 295,
            has_subtitles: 1,
            has_lyrics: 1,
            instrumental: 0,
            ...overrides,
          },
        },
      ],
    },
  },
});

describe('decodeMusixmatchText', () => {
  it('decodes numeric entities (garbled-text root cause)', () => {
    expect(decodeMusixmatchText('&#26446;&#33635;')).toBe('李荣');
  });

  it('decodes hexadecimal entities', () => {
    expect(decodeMusixmatchText('&#x4F60;&#x597D;')).toBe('你好');
  });

  it('decodes named entities', () => {
    expect(decodeMusixmatchText('Tom &amp; Jerry &quot;hi&quot; &lt;note&gt;')).toBe(
      'Tom & Jerry "hi" <note>',
    );
  });

  it('leaves text without entities untouched', () => {
    expect(decodeMusixmatchText('晴天')).toBe('晴天');
  });

  it('drops out-of-range and invalid code points', () => {
    expect(decodeMusixmatchText('a&#0;b&#99999999;c&#x110000;d')).toBe('abcd');
  });
});

describe('parseMusixmatchSearchResponse', () => {
  it('extracts track candidates from a signed search response', () => {
    const tracks = parseMusixmatchSearchResponse(searchResponse({}));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      trackId: 1,
      trackName: 'Hello',
      artistName: 'Adele',
      trackLength: 295,
      hasSubtitles: true,
      hasLyrics: true,
      instrumental: false,
    });
  });

  it('returns an empty list for non-200 status', () => {
    expect(parseMusixmatchSearchResponse({ message: { header: { status_code: 404 } } })).toEqual(
      [],
    );
  });

  it('returns an empty list for malformed responses', () => {
    expect(parseMusixmatchSearchResponse(null)).toEqual([]);
    expect(parseMusixmatchSearchResponse({})).toEqual([]);
    expect(
      parseMusixmatchSearchResponse({ message: { header: { status_code: 200 }, body: {} } }),
    ).toEqual([]);
  });
});

describe('pickMusixmatchTrack', () => {
  const query = { artist: 'Adele', title: 'Hello', album: '25', durationMs: 295000 };

  it('excludes honeypot tracks', () => {
    const response = searchResponse({ track_id: 115264642, track_name: 'Paradise' });
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)).toBeNull();
  });

  it('excludes instrumental tracks', () => {
    const response = searchResponse({ instrumental: 1 });
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)).toBeNull();
  });

  it('excludes tracks without lyrics or subtitles', () => {
    const response = searchResponse({ has_subtitles: 0, has_lyrics: 0 });
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)).toBeNull();
  });

  it('keeps tracks within the duration tolerance', () => {
    const response = searchResponse({ track_length: 300 });
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)?.trackId).toBe(1);
  });

  it('excludes tracks beyond the duration tolerance', () => {
    const response = searchResponse({ track_length: 400 });
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)).toBeNull();
  });

  it('prefers synced subtitles over plain lyrics', () => {
    const response = {
      message: {
        header: { status_code: 200 },
        body: {
          track_list: [
            {
              track: {
                track_id: 2,
                track_name: 'a',
                track_length: 295,
                has_subtitles: 0,
                has_lyrics: 1,
              },
            },
            {
              track: {
                track_id: 3,
                track_name: 'b',
                track_length: 295,
                has_subtitles: 1,
                has_lyrics: 1,
              },
            },
          ],
        },
      },
    };
    expect(pickMusixmatchTrack(parseMusixmatchSearchResponse(response), query)?.trackId).toBe(3);
  });

  it('still picks a track when the query has no duration', () => {
    const response = searchResponse({ track_length: 0 });
    expect(
      pickMusixmatchTrack(parseMusixmatchSearchResponse(response), { ...query, durationMs: null })
        ?.trackId,
    ).toBe(1);
  });
});

describe('parseMusixmatchSubtitleResponse', () => {
  it('parses an LRC subtitle body with decoded entities', () => {
    const response = {
      message: {
        header: { status_code: 200 },
        body: {
          subtitle_list: [
            {
              subtitle: {
                restricted: 0,
                subtitle_body: '[00:01.00]&#26446;&#33635;&#27963;\n[00:05.00]&amp;晴天',
              },
            },
          ],
        },
      },
    };

    const result = parseMusixmatchSubtitleResponse(response, track);
    expect(result).not.toBeNull();
    if (!result || result.kind !== 'synced') {
      throw new Error('Expected synced result');
    }
    expect(result.track).toEqual(track);
    expect(result.lines).toEqual([
      { timeMs: 1000, text: '李荣活' },
      { timeMs: 5000, text: '&晴天' },
    ]);
    expect(result.wordLines).toEqual([]);
    expect(result.source).toBe('Musixmatch');
  });

  it('maps auth rejections to an explicit error', () => {
    const response = { message: { header: { status_code: 403 } } };
    const result = parseMusixmatchSubtitleResponse(response, track);
    expect(result).toEqual({ kind: 'error', reason: 'musixmatch auth rejected' });
  });

  it('returns null when restricted or empty', () => {
    const restricted = {
      message: {
        header: { status_code: 200 },
        body: { subtitle_list: [{ subtitle: { restricted: 1, subtitle_body: '[00:01.00]x' } }] },
      },
    };
    expect(parseMusixmatchSubtitleResponse(restricted, track)).toBeNull();

    const empty = {
      message: {
        header: { status_code: 200 },
        body: { subtitle_list: [{ subtitle: { restricted: 0, subtitle_body: '' } }] },
      },
    };
    expect(parseMusixmatchSubtitleResponse(empty, track)).toBeNull();
  });
});

describe('parseMusixmatchLyricsResponse', () => {
  it('parses a plain lyrics body and strips the commercial-use watermark', () => {
    const response = {
      message: {
        header: { status_code: 200 },
        body: {
          lyrics: {
            instrumental: 0,
            lyrics_body:
              'line one\nline two\n******* This Lyrics is NOT for Commercial use *******',
          },
        },
      },
    };

    const result = parseMusixmatchLyricsResponse(response, track);
    expect(result).toEqual({
      kind: 'plain',
      track,
      text: 'line one\nline two',
      source: 'Musixmatch',
    });
  });

  it('returns an instrumental result', () => {
    const response = {
      message: {
        header: { status_code: 200 },
        body: { lyrics: { instrumental: 1, lyrics_body: '' } },
      },
    };
    expect(parseMusixmatchLyricsResponse(response, track)).toEqual({
      kind: 'instrumental',
      track,
    });
  });

  it('maps auth rejections to an explicit error', () => {
    const response = { message: { header: { status_code: 401 } } };
    expect(parseMusixmatchLyricsResponse(response, track)).toEqual({
      kind: 'error',
      reason: 'musixmatch auth rejected',
    });
  });
});
