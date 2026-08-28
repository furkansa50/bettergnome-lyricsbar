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
 *   autoWidth: boolean,
 * }>} IndicatorViewModel
 */

/**
 * @param {DisplayState} state
 * @param {LyricBarSettings} settings
 * @returns {IndicatorViewModel}
 */
export function buildIndicatorViewModel(state, settings) {
  // When autoWidth is enabled, word-by-word timing highlight is suppressed because dynamic
  // width recalculation causes severe GNOME top panel jitter.
  const effectiveState =
    settings.autoWidth && state.kind === 'lyrics'
      ? { ...state, words: [], activeWordIndex: -1 }
      : state;

  const display = formatDisplayState(
    effectiveState,
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
    words: effectiveState.kind === 'lyrics' ? effectiveState.words : [],
    activeWordIndex: effectiveState.kind === 'lyrics' ? effectiveState.activeWordIndex : -1,
    autoWidth: settings.autoWidth,
  };
}
