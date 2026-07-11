import { describe, expect, it } from 'vitest';

import { buildLabelStyleString } from '../../src/domain/display/style.js';

const GLOW_SHADOW =
  '0 0 8px rgba(255, 255, 255, 0.6), 0 0 16px rgba(255, 255, 255, 0.4), 0 0 24px rgba(255, 255, 255, 0.2)';

describe('buildLabelStyleString', () => {
  it('builds style string with default white preset and text shadow enabled', () => {
    const result = buildLabelStyleString({
      maxWidth: 360,
      textAlign: 'left',
      textColorMode: 'default',
      customTextColor: '#ffffff',
      textShadowEnabled: true,
    });
    expect(result).toBe(
      `width: 360px; min-width: 1px; text-align: left; color: #ffffff; text-shadow: ${GLOW_SHADOW};`,
    );
  });

  it('builds style string with white color preset', () => {
    const result = buildLabelStyleString({
      maxWidth: 240,
      textAlign: 'center',
      textColorMode: 'white',
      customTextColor: '#ffffff',
      textShadowEnabled: false,
    });
    expect(result).toBe(
      'width: 240px; min-width: 1px; text-align: center; color: #ffffff; text-shadow: none;',
    );
  });

  it('builds style string with black color preset', () => {
    const result = buildLabelStyleString({
      maxWidth: 180,
      textAlign: 'right',
      textColorMode: 'black',
      customTextColor: '#ffffff',
      textShadowEnabled: true,
    });
    expect(result).toBe(
      `width: 180px; min-width: 1px; text-align: right; color: #000000; text-shadow: ${GLOW_SHADOW};`,
    );
  });

  it('builds style string with custom hex color', () => {
    const result = buildLabelStyleString({
      maxWidth: 360,
      textAlign: 'left',
      textColorMode: 'custom',
      customTextColor: '#ff55aa',
      textShadowEnabled: true,
    });
    expect(result).toBe(
      `width: 360px; min-width: 1px; text-align: left; color: #ff55aa; text-shadow: ${GLOW_SHADOW};`,
    );
  });

  it('builds style string with system color preset (omitting color attribute)', () => {
    const result = buildLabelStyleString({
      maxWidth: 360,
      textAlign: 'left',
      textColorMode: 'system',
      customTextColor: '#ffffff',
      textShadowEnabled: false,
    });
    expect(result).toBe('width: 360px; min-width: 1px; text-align: left; text-shadow: none;');
  });

  it('disables text shadow even if enabled when word-timed lyrics are active', () => {
    const result = buildLabelStyleString({
      maxWidth: 360,
      textAlign: 'left',
      textColorMode: 'default',
      customTextColor: '#ffffff',
      textShadowEnabled: true,
      words: [{ beginMs: 1000, endMs: 2000, text: 'Hello' }],
    });
    expect(result).toBe(
      'width: 360px; min-width: 1px; text-align: left; color: #ffffff; text-shadow: none;',
    );
  });
});
