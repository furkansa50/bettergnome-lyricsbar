import { describe, expect, it } from 'vitest';

import {
  normalizeFallbackMode,
  normalizeBrowserPlayerService,
  normalizeMaxWidth,
  normalizePanelPosition,
  normalizePlayerPriority,
  normalizeSettings,
  normalizeTextAlign,
  normalizeTextColorMode,
  normalizeCustomTextColor,
  normalizeGlowStrength,
  normalizeLyricsSource,
  normalizeBlurEffect,
} from '../../src/domain/settings/normalize.js';

describe('normalizeSettings', () => {
  it('normalizes valid settings', () => {
    expect(
      normalizeSettings({
        panelPosition: 'left',
        maxWidth: 420,
        textAlign: 'center',
        fallbackMode: 'hidden',
        showSettingsIcon: false,
        hideWhenIdle: false,
        playerPriority: ['spotify', 'firefox'],
        browserPlayerService: 'generic',
        lyricsSource: 'better-lyrics',
        cacheEnabled: false,
        debugLogging: true,
        textColorMode: 'custom',
        customTextColor: '#ff007f',
        textShadowEnabled: false,
        glowStrength: 1.5,
        autoWidth: false,
        blurEffect: 'always',
      }),
    ).toEqual({
      panelPosition: 'left',
      maxWidth: 420,
      textAlign: 'center',
      fallbackMode: 'hidden',
      showSettingsIcon: false,
      hideWhenIdle: false,
      playerPriority: ['spotify', 'firefox'],
      browserPlayerService: 'generic',
      lyricsSource: 'better-lyrics',
      cacheEnabled: false,
      debugLogging: true,
      textColorMode: 'custom',
      customTextColor: '#ff007f',
      textShadowEnabled: false,
      glowStrength: 1.5,
      autoWidth: false,
      blurEffect: 'always',
    });
  });

  it('falls back safely for invalid settings', () => {
    expect(
      normalizeSettings({
        panelPosition: 'bad',
        maxWidth: 'wide',
        textAlign: 'bad',
        fallbackMode: 'loud',
        showSettingsIcon: 'yes',
        playerPriority: 'spotify',
        browserPlayerService: 'bad',
        lyricsSource: 'unknown-source',
        cacheEnabled: 'yes',
        debugLogging: 'no',
        textColorMode: 'orange',
        customTextColor: 'rgb(255,0,0)',
        textShadowEnabled: 'yes',
        glowStrength: 'strong',
        blurEffect: 'invalid',
      }),
    ).toEqual({
      panelPosition: 'center',
      maxWidth: 360,
      textAlign: 'left',
      fallbackMode: 'track',
      showSettingsIcon: true,
      hideWhenIdle: true,
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
      blurEffect: 'auto',
    });
  });
});

describe('normalizePanelPosition', () => {
  it('accepts known panel positions', () => {
    expect(normalizePanelPosition('right')).toBe('right');
  });

  it('rejects unknown panel positions', () => {
    expect(normalizePanelPosition('top')).toBe('center');
  });
});

describe('normalizeMaxWidth', () => {
  it('rounds finite numbers', () => {
    expect(normalizeMaxWidth(244.7)).toBe(245);
  });

  it('clamps below minimum', () => {
    expect(normalizeMaxWidth(20)).toBe(120);
  });

  it('clamps above maximum', () => {
    expect(normalizeMaxWidth(1200)).toBe(720);
  });
});

describe('normalizeFallbackMode', () => {
  it('accepts known fallback modes', () => {
    expect(normalizeFallbackMode('idle')).toBe('idle');
  });

  it('rejects unknown fallback modes', () => {
    expect(normalizeFallbackMode('error')).toBe('track');
  });
});

describe('normalizePlayerPriority', () => {
  it('normalizes, lowercases, deduplicates, and removes empty fragments', () => {
    expect(normalizePlayerPriority([' Spotify ', '', 'SPOTIFY', 'Firefox'])).toEqual([
      'spotify',
      'firefox',
    ]);
  });
});

describe('normalizeBrowserPlayerService', () => {
  it('accepts known browser player services', () => {
    expect(normalizeBrowserPlayerService('auto')).toBe('auto');
    expect(normalizeBrowserPlayerService('spotify')).toBe('spotify');
    expect(normalizeBrowserPlayerService('youtube-music')).toBe('youtube-music');
    expect(normalizeBrowserPlayerService('apple-music')).toBe('apple-music');
    expect(normalizeBrowserPlayerService('generic')).toBe('generic');
  });

  it('rejects unknown browser player services', () => {
    expect(normalizeBrowserPlayerService('youtube')).toBe('auto');
  });
});

describe('normalizeTextAlign', () => {
  it('accepts known text aligns', () => {
    expect(normalizeTextAlign('center')).toBe('center');
  });

  it('rejects unknown text aligns', () => {
    expect(normalizeTextAlign('top')).toBe('left');
  });
});

describe('normalizeTextColorMode', () => {
  it('accepts known color preset types', () => {
    expect(normalizeTextColorMode('system')).toBe('system');
    expect(normalizeTextColorMode('white')).toBe('white');
    expect(normalizeTextColorMode('black')).toBe('black');
    expect(normalizeTextColorMode('custom')).toBe('custom');
    expect(normalizeTextColorMode('default')).toBe('default');
  });

  it('rejects unknown types', () => {
    expect(normalizeTextColorMode('blue')).toBe('default');
  });
});

describe('normalizeCustomTextColor', () => {
  it('accepts valid hex colors', () => {
    expect(normalizeCustomTextColor('#fff')).toBe('#fff');
    expect(normalizeCustomTextColor('#FF0033')).toBe('#FF0033');
    expect(normalizeCustomTextColor('  #12f45a  ')).toBe('#12f45a');
  });

  it('rejects invalid inputs and returns default', () => {
    expect(normalizeCustomTextColor('red')).toBe('#ffffff');
    expect(normalizeCustomTextColor('#1234')).toBe('#ffffff');
    expect(normalizeCustomTextColor('123456')).toBe('#ffffff');
    expect(normalizeCustomTextColor(123)).toBe('#ffffff');
  });
});

describe('normalizeGlowStrength', () => {
  it('accepts valid glow strengths', () => {
    expect(normalizeGlowStrength(1.2)).toBe(1.2);
    expect(normalizeGlowStrength(0.5)).toBe(0.5);
  });

  it('clamps values out of range', () => {
    expect(normalizeGlowStrength(-0.5)).toBe(0.0);
    expect(normalizeGlowStrength(3.0)).toBe(2.0);
  });

  it('rejects invalid input types and returns default', () => {
    expect(normalizeGlowStrength('strong')).toBe(1.0);
    expect(normalizeGlowStrength(null)).toBe(1.0);
  });
});

describe('normalizeLyricsSource', () => {
  it('accepts known lyrics sources', () => {
    expect(normalizeLyricsSource('musixmatch')).toBe('musixmatch');
    expect(normalizeLyricsSource('better-lyrics')).toBe('better-lyrics');
    expect(normalizeLyricsSource('lrclib')).toBe('lrclib');
  });

  it('rejects unknown lyrics sources', () => {
    expect(normalizeLyricsSource('auto')).toBe('musixmatch');
    expect(normalizeLyricsSource('unknown')).toBe('musixmatch');
    expect(normalizeLyricsSource(null)).toBe('musixmatch');
  });
});

describe('normalizeBlurEffect', () => {
  it('accepts known blur effect modes', () => {
    expect(normalizeBlurEffect('auto')).toBe('auto');
    expect(normalizeBlurEffect('always')).toBe('always');
    expect(normalizeBlurEffect('disabled')).toBe('disabled');
  });

  it('rejects unknown blur effect modes and falls back to auto', () => {
    expect(normalizeBlurEffect('invalid')).toBe('auto');
    expect(normalizeBlurEffect(null)).toBe('auto');
    expect(normalizeBlurEffect(undefined)).toBe('auto');
  });
});
