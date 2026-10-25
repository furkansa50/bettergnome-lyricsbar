import { describe, expect, it } from 'vitest';
import {
  parseBestSyncedLrclibSearchResponse,
  parseBestSyncedLrclibTitleSearchResponse,
} from '../../src/domain/lyrics/provider-result.js';

describe('parseBestSyncedLrclibSearchResponse (CJK)', () => {
  const lrclibResults = [
    {
      id: 1,
      trackName: '碎碎念',
      artistName: '队长',
      albumName: '碎碎念',
      duration: 132,
      syncedLyrics: '[00:10.00]所以別再問那麼多問題\n[00:14.00]回憶全部都被你給佔據',
      plainLyrics: 'x',
    },
    {
      id: 2,
      trackName: '碎碎念',
      artistName: '队长',
      albumName: '碎碎念',
      duration: 212,
      syncedLyrics: '[00:10.00]另一版本',
      plainLyrics: 'x',
    },
    {
      id: 3,
      trackName: '碎碎念',
      artistName: '队长',
      albumName: 'talking - ep',
      duration: 133,
      syncedLyrics: '[00:10.00]EP版本歌詞',
      plainLyrics: 'x',
    },
  ];

  it('keeps CJK titles/artists comparable and prefers the closest duration', () => {
    const result = parseBestSyncedLrclibSearchResponse(lrclibResults, {
      artist: '队长',
      title: '碎碎念',
      album: '碎碎念 - Single',
      durationMs: 133000,
    });
    expect(result?.kind).toBe('synced');
    if (result?.kind === 'synced') {
      expect(result.track.durationMs).toBe(133000);
      expect(result.lines[0].text).toBe('EP版本歌詞');
    }
  });

  it('matches a CJK query against CJK candidates with a moderate duration gap', () => {
    const result = parseBestSyncedLrclibSearchResponse(lrclibResults, {
      artist: '队长',
      title: '碎碎念',
      album: '碎碎念',
      durationMs: 235000,
    });
    expect(result?.kind).toBe('synced');
    if (result?.kind === 'synced') {
      expect(result.track.durationMs).toBe(212000);
    }
  });

  it('still scores latin titles the same way as before', () => {
    const result = parseBestSyncedLrclibSearchResponse(
      [
        {
          trackName: 'Café',
          artistName: 'Chino & hollow',
          albumName: 'x',
          duration: 200,
          syncedLyrics: '[00:01.00]a',
        },
      ],
      { artist: 'Chino & hollow', title: 'Café', album: 'x', durationMs: 200000 },
    );
    expect(result?.kind).toBe('synced');
  });
});

describe('parseBestSyncedLrclibTitleSearchResponse', () => {
  // 真实场景: Spotify 上报繁体「隊長」, LRCLIB 收录为简体「队长」
  const titleOnlyResults = [
    {
      id: 1,
      trackName: '碎碎念',
      artistName: 'Triple G',
      albumName: 'x',
      duration: 0,
      syncedLyrics: '[00:01.00]a',
    },
    {
      id: 2,
      trackName: '碎碎念',
      artistName: '熊貓堂ProducePandas',
      albumName: 'x',
      duration: 206,
      syncedLyrics: '[00:01.00]b',
    },
    {
      id: 3,
      trackName: '碎碎念',
      artistName: '羅志祥',
      albumName: 'x',
      duration: 267,
      syncedLyrics: '[00:01.00]c',
    },
    {
      id: 4,
      trackName: '碎碎念',
      artistName: '劉畊宏',
      albumName: 'x',
      duration: 241,
      syncedLyrics: '[00:01.00]d',
    },
    {
      id: 5,
      trackName: '碎碎念',
      artistName: '队长',
      albumName: '碎碎念',
      duration: 132,
      syncedLyrics: '[00:10.00]所以別再問那麼多問題',
      plainLyrics: 'x',
    },
    {
      id: 6,
      trackName: '碎碎念',
      artistName: '队长',
      albumName: 'talking - ep',
      duration: 133,
      syncedLyrics: '[00:10.00]EP版本',
      plainLyrics: 'x',
    },
  ];
  const spotifyQuery = { artist: '隊長', title: '碎碎念', album: '碎碎念', durationMs: 132682 };

  it('ignores the artist spelling and picks the closest-duration same-title song', () => {
    const result = parseBestSyncedLrclibTitleSearchResponse(titleOnlyResults, spotifyQuery);
    expect(result?.kind).toBe('synced');
    if (result?.kind === 'synced') {
      expect(result.track.durationMs).toBe(133000);
      expect(result.lines[0].text).toBe('EP版本');
    }
  });

  it('rejects everything when only other artists far-off versions exist', () => {
    const result = parseBestSyncedLrclibTitleSearchResponse(
      [titleOnlyResults[2], titleOnlyResults[3]],
      spotifyQuery,
    );
    expect(result).toBeNull();
  });

  it('refuses to guess when the query duration is unknown', () => {
    const result = parseBestSyncedLrclibTitleSearchResponse(titleOnlyResults, {
      ...spotifyQuery,
      durationMs: null,
    });
    expect(result).toBeNull();
  });
});
