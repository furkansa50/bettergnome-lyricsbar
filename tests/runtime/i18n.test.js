import { describe, expect, it } from 'vitest';

import { _t } from '../../src/runtime/i18n.js';

describe('_t localization helper', () => {
  it('returns a string without throwing', () => {
    const result = _t('English', 'Türkçe');
    expect(typeof result).toBe('string');
    expect(['English', 'Türkçe']).toContain(result);
  });

  it('returns Turkish string when locale is tr', () => {
    const origDateTimeFormat = Intl.DateTimeFormat;
    /** @type {any} */ (Intl).DateTimeFormat = () => ({
      resolvedOptions: () => ({ locale: 'tr-TR' }),
    });

    try {
      expect(_t('Better Lyrics Bar Settings', 'Better Lyrics Bar Ayarları')).toBe(
        'Better Lyrics Bar Ayarları',
      );
    } finally {
      Intl.DateTimeFormat = origDateTimeFormat;
    }
  });

  it('returns English string when locale is en', () => {
    const origDateTimeFormat = Intl.DateTimeFormat;
    /* eslint-disable dot-notation */
    const origLC = process.env['LC_ALL'];
    const origLCMessages = process.env['LC_MESSAGES'];
    const origLang = process.env['LANG'];

    /** @type {any} */ (Intl).DateTimeFormat = () => ({
      resolvedOptions: () => ({ locale: 'en-US' }),
    });
    delete process.env['LC_ALL'];
    delete process.env['LC_MESSAGES'];
    delete process.env['LANG'];

    try {
      expect(_t('Better Lyrics Bar Settings', 'Better Lyrics Bar Ayarları')).toBe(
        'Better Lyrics Bar Settings',
      );
    } finally {
      Intl.DateTimeFormat = origDateTimeFormat;
      if (origLC !== undefined) {
        process.env['LC_ALL'] = origLC;
      }
      if (origLCMessages !== undefined) {
        process.env['LC_MESSAGES'] = origLCMessages;
      }
      if (origLang !== undefined) {
        process.env['LANG'] = origLang;
      }
    }
    /* eslint-enable dot-notation */
  });
});
