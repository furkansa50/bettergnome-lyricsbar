import { describe, expect, it } from 'vitest';

import {
  parseMusixmatchRichSync,
  parseMusixmatchResponse,
} from '../../src/domain/lyrics/musixmatch.js';

describe('parseMusixmatchRichSync', () => {
  const track = {
    trackName: 'Hello',
    artistName: 'Adele',
    albumName: '25',
    durationMs: 295000,
  };

  it('parses valid richsync data into WordTimedLyricLine array', () => {
    const data = [
      {
        ts: 6.23,
        te: 9.69,
        l: [
          { c: 'Hello,', o: 0 },
          { c: ' ', o: 1.639 },
          { c: "it's", o: 1.773 },
          { c: ' ', o: 2.235 },
          { c: 'me', o: 2.315 },
        ],
        x: "Hello, it's me",
      },
      {
        ts: 11.84,
        te: 15.0,
        l: [
          { c: 'I ', o: 0 },
          { c: 'was', o: 0.5 },
        ],
        x: 'I was',
      },
    ];

    const result = parseMusixmatchRichSync(data, track);
    expect(result).not.toBeNull();
    if (!result || result.kind !== 'synced') {
      throw new Error('Expected synced result');
    }

    expect(result.track).toEqual(track);
    expect(result.lines).toHaveLength(2);
    expect(result.wordLines).toHaveLength(2);

    const line0 = result.wordLines[0];
    expect(line0?.timeMs).toBe(6230);
    expect(line0?.endMs).toBe(9690);
    expect(line0?.text).toBe("Hello, it's me");
    expect(line0?.words).toHaveLength(3);

    expect(line0?.words[0]).toEqual({
      beginMs: 6230,
      endMs: 8003,
      text: 'Hello,',
      trailingSpace: true,
    });
    expect(line0?.words[1]).toEqual({
      beginMs: 8003,
      endMs: 8545,
      text: "it's",
      trailingSpace: true,
    });
    expect(line0?.words[2]).toEqual({
      beginMs: 8545,
      endMs: 9690,
      text: 'me',
      trailingSpace: false,
    });

    const line1 = result.wordLines[1];
    expect(line1?.words[0]?.trailingSpace).toBe(true);
  });

  it('returns null for empty or invalid data', () => {
    expect(parseMusixmatchRichSync([], track)).toBeNull();
    expect(parseMusixmatchRichSync(null, track)).toBeNull();
    expect(parseMusixmatchRichSync('not an array', track)).toBeNull();
  });
});

describe('parseMusixmatchResponse', () => {
  const track = {
    trackName: 'Hello',
    artistName: 'Adele',
    albumName: '25',
    durationMs: 295000,
  };

  it('parses macro response containing track.richsync.get', () => {
    const macroResponse = {
      message: {
        header: { status_code: 200 },
        body: {
          macro_calls: {
            'track.richsync.get': {
              message: {
                header: { status_code: 200 },
                body: {
                  richsync: {
                    richsync_body: JSON.stringify([
                      {
                        ts: 1.0,
                        te: 3.0,
                        l: [
                          { c: 'Hello', o: 0 },
                          { c: 'world', o: 1.0 },
                        ],
                        x: 'Hello world',
                      },
                    ]),
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parseMusixmatchResponse(macroResponse, track);
    expect(result.kind).toBe('synced');
    if (result.kind === 'synced') {
      expect(result.wordLines).toHaveLength(1);
      expect(result.wordLines[0]?.words).toHaveLength(2);
    }
  });

  it('falls back to track.subtitles.get LRC when richsync is missing', () => {
    const macroResponse = {
      message: {
        header: { status_code: 200 },
        body: {
          macro_calls: {
            'track.richsync.get': {
              message: {
                header: { status_code: 404 },
              },
            },
            'track.subtitles.get': {
              message: {
                header: { status_code: 200 },
                body: {
                  subtitle_list: [
                    {
                      subtitle: {
                        subtitle_body: "[00:06.22] Hello, it's me\n[00:11.84] I was wondering",
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };

    const result = parseMusixmatchResponse(macroResponse, track);
    expect(result.kind).toBe('synced');
    if (result.kind === 'synced') {
      expect(result.lines).toHaveLength(2);
      expect(result.wordLines).toHaveLength(0);
    }
  });

  it('handles 404 status as not-found', () => {
    const response = {
      message: {
        header: { status_code: 404 },
      },
    };
    expect(parseMusixmatchResponse(response, track)).toEqual({ kind: 'not-found' });
  });

  it('handles rate limited 429 status as error', () => {
    const response = {
      message: {
        header: { status_code: 429 },
      },
    };
    expect(parseMusixmatchResponse(response, track)).toEqual({
      kind: 'error',
      reason: 'rate limited',
    });
  });
});
