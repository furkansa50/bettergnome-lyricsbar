import { BLACK_TEXT_COLOR, WHITE_TEXT_COLOR } from '../settings/appearance.js';

/**
 * @typedef {{
 *   maxWidth: number,
 *   autoWidth?: boolean,
 *   textAlign: import('../settings/types.js').TextAlign,
 *   textColorMode: import('../settings/types.js').TextColorMode,
 *   customTextColor: string,
 *   textShadowEnabled: boolean,
 *   glowStrength: number,
 *   words?: readonly import('../lyrics/types.js').WordTiming[],
 * }} LabelStyleOptions
 */

/**
 * Builds the inline CSS style string for the LyricBar top-bar label.
 *
 * @param {LabelStyleOptions} options
 * @returns {string} The CSS style string.
 */
export function buildLabelStyleString(options) {
  const widthProp = options.autoWidth
    ? `max-width: ${options.maxWidth}px; min-width: 1px;`
    : `width: ${options.maxWidth}px; min-width: 1px;`;
  let style = `${widthProp} text-align: ${options.textAlign};`;

  const hasWordTimings = Boolean(options.words && options.words.length > 0);

  // In GNOME Shell, setting `color:` in CSS on the label overrides the
  // Pango markup foreground colors on child spans, so omit CSS color during word timings.
  if (!hasWordTimings) {
    if (options.textColorMode === 'default' || options.textColorMode === 'white') {
      style += ` color: ${WHITE_TEXT_COLOR};`;
    } else if (options.textColorMode === 'black') {
      style += ` color: ${BLACK_TEXT_COLOR};`;
    } else if (options.textColorMode === 'custom' && options.customTextColor) {
      style += ` color: ${options.customTextColor};`;
    }
  }

  // Always apply text-shadow glow when enabled by the user
  if (options.textShadowEnabled) {
    style += ` text-shadow: ${buildTextShadowString(options.glowStrength)};`;
  } else {
    style += ' text-shadow: none;';
  }

  return style;
}

/**
 * @param {number} strength
 * @returns {string}
 */
export function buildTextShadowString(strength) {
  if (strength <= 0) {
    return 'none';
  }
  const s1 = Number(Math.min(1.0, 0.6 * strength).toFixed(2)).toString();
  const s2 = Number(Math.min(1.0, 0.4 * strength).toFixed(2)).toString();
  const s3 = Number(Math.min(1.0, 0.2 * strength).toFixed(2)).toString();
  return `0 0 8px rgba(255, 255, 255, ${s1}), 0 0 16px rgba(255, 255, 255, ${s2}), 0 0 24px rgba(255, 255, 255, ${s3})`;
}
