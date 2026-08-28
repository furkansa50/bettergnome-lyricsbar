import { describe, expect, it } from 'vitest';

import { buildIndicatorViewModel } from '../../src/domain/display/view-model.js';

/**
 * @import { LyricBarSettings } from '../../src/domain/settings/types.js'
 */

/** @type {LyricBarSettings} */
const baseSettings = {
  panelPosition: 'center',
  maxWidth: 360,
  textAlign: 'left',
  fallbackMode: 'track',
  showSettingsIcon: true,
  hideWhenIdle: false,
  playerPriority: ['spotify'],
  browserPlayerService: 'auto',
  lyricsSource: 'musixmatch',
  cacheEnabled: true,
  debugLogging: false,
  textColorMode: 'default',
  customTextColor: '#ffffff',
  textShadowEnabled: true,
  glowStrength: 1.0,
  autoWidth: true,
};

describe('buildIndicatorViewModel', () => {
  it('formats visible text and width for lyric state', () => {
    expect(
      buildIndicatorViewModel(
        {
          kind: 'lyrics',
          line: 'Hello world',
          words: [],
          activeWordIndex: -1,
        },
        baseSettings,
      ),
    ).toEqual({
      text: 'Hello world',
      visible: true,
      maxWidth: 360,
      textAlign: 'left',
      textColorMode: 'default',
      customTextColor: '#ffffff',
      textShadowEnabled: true,
      glowStrength: 1.0,
      words: [],
      activeWordIndex: -1,
      autoWidth: true,
    });
  });

  it('passes hidden visibility through to the Shell layer', () => {
    expect(
      buildIndicatorViewModel(
        {
          kind: 'idle',
        },
        {
          ...baseSettings,
          fallbackMode: 'hidden',
          maxWidth: 240,
        },
      ),
    ).toEqual({
      text: '',
      visible: false,
      maxWidth: 240,
      textAlign: 'left',
      textColorMode: 'default',
      customTextColor: '#ffffff',
      textShadowEnabled: true,
      glowStrength: 1.0,
      words: [],
      activeWordIndex: -1,
      autoWidth: true,
    });
  });

  it('suppresses word-by-word timing when autoWidth is true to prevent panel jitter', () => {
    const wordTimedState = {
      kind: /** @type {const} */ ('lyrics'),
      line: 'Hello world',
      words: [
        { text: 'Hello', timeMs: 1000, durationMs: 500 },
        { text: 'world', timeMs: 1500, durationMs: 500 },
      ],
      activeWordIndex: 0,
    };

    const vm = buildIndicatorViewModel(wordTimedState, {
      ...baseSettings,
      autoWidth: true,
    });

    expect(vm.autoWidth).toBe(true);
    expect(vm.words).toEqual([]);
    expect(vm.activeWordIndex).toBe(-1);
    expect(vm.text).toBe('Hello world');
  });

  it('preserves word-by-word timing when autoWidth is false', () => {
    const wordTimedState = {
      kind: /** @type {const} */ ('lyrics'),
      line: 'Hello world',
      words: [
        { text: 'Hello', timeMs: 1000, durationMs: 500 },
        { text: 'world', timeMs: 1500, durationMs: 500 },
      ],
      activeWordIndex: 0,
    };

    const vm = buildIndicatorViewModel(wordTimedState, {
      ...baseSettings,
      autoWidth: false,
    });

    expect(vm.autoWidth).toBe(false);
    expect(vm.words).toHaveLength(2);
    expect(vm.activeWordIndex).toBe(0);
    expect(vm.text).toContain('weight="bold"');
    expect(vm.text).toContain('Hello');
  });
});
