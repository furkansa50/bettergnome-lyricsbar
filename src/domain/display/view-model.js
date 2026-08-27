import { formatDisplayState } from './state.js';

/**
 * @import { DisplayState } from './types.js'
 * @import { LyricBarSettings } from '../settings/types.js'
 * @import { WordTiming } from '../lyrics/types.js'
 *
 * @typedef {Readonly<{
 *   text: string,
 *   visible: boolean,
 *   maxWidth: number,
 *   textAlign: import('../settings/types.js').TextAlign,
 *   textColorMode: import('../settings/types.js').TextColorMode,
 *   customTextColor: string,
 *   textShadowEnabled: boolean,
 *   glowStrength: number,
 *   words: readonly WordTiming[],
 *   activeWordIndex: number,
 * }>} IndicatorViewModel
 */

/**
 * @param {DisplayState} state
 * @param {LyricBarSettings} settings
 * @returns {IndicatorViewModel}
 */
export function buildIndicatorViewModel(state, settings) {
  const display = formatDisplayState(
    state,
    settings.fallbackMode,
    settings.textColorMode,
    settings.customTextColor,
  );

  return {
    text: display.text,
    visible: display.visible,
    maxWidth: settings.maxWidth,
    textAlign: settings.textAlign,
    textColorMode: settings.textColorMode,
    customTextColor: settings.customTextColor,
    textShadowEnabled: settings.textShadowEnabled,
    glowStrength: settings.glowStrength,
    words: state.kind === 'lyrics' ? state.words : [],
    activeWordIndex: state.kind === 'lyrics' ? state.activeWordIndex : -1,
  };
}
