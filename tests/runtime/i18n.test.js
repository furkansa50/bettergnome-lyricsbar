import { describe, expect, it } from 'vitest';

import { _t } from '../../src/runtime/i18n.js';

describe('_t localization helper', () => {
  it('returns a string without throwing', () => {
    const result = _t('English', 'Türkçe');
    expect(typeof result).toBe('string');
    expect(['English', 'Türkçe']).toContain(result);
  });
});
