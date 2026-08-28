const DEFAULT_IDLE_TEXT = 'LyricBar';
const DEFAULT_LOADING_PREFIX = 'Loading lyrics';
const DEFAULT_ERROR_TEXT = 'Lyrics unavailable';
const UNKNOWN_TRACK_TEXT = 'Unknown track';

/**
 * @import {
 *   DisplayState,
 *   DisplayText,
 *   DisplayTrack,
 *   FallbackMode,
 * } from './types.js'
 */

/**
 * Helper to escape special XML characters so they don't break Pango markup parsing.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeMarkup(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * @param {DisplayState} state
 * @param {FallbackMode} fallbackMode
 * @param {import('../settings/types.js').TextColorMode} [textColorMode]
 * @param {string} [customTextColor]
 * @returns {DisplayText}
 */
export function formatDisplayState(
  state,
  fallbackMode,
  textColorMode = 'default',
  customTextColor = '',
) {
  if (state.kind === 'hidden') {
    return hiddenText();
  }

  if (state.kind === 'lyrics') {
    const line = normalizeText(state.line);
    if (line !== '') {
      // If we have word-level timings and a valid highlighted word index
      if (state.words && state.words.length > 0) {
        let baseColor = '#ffffff';
        if (textColorMode === 'black') {
          baseColor = '#000000';
        } else if (textColorMode === 'custom' && /^#[0-9a-fA-F]{6}$/.test(customTextColor)) {
          baseColor = customTextColor;
        }
        const dimmedColor = '#595959';

        const wordMarkup = state.words.map(
          /**
           * @param {import('../lyrics/types.js').WordTiming} w
           * @param {number} idx
           */
          (w, idx) => {
            const escapedWord = escapeMarkup(w.text);
            const isLast = idx === state.words.length - 1;
            const space = (w.trailingSpace ?? !isLast) ? ' ' : '';
            if (idx === state.activeWordIndex) {
              // Active word: bold, full opacity
              return `<span foreground="${baseColor}" weight="bold">${escapedWord}</span>${space}`;
            }
            if (idx < state.activeWordIndex) {
              // Past words: normal weight, full opacity
              return `<span foreground="${baseColor}">${escapedWord}</span>${space}`;
            }
            // Future words: translucent/dimmed
            return `<span foreground="${dimmedColor}">${escapedWord}</span>${space}`;
          },
        );
        return { text: `\u200B${wordMarkup.join('')}`, visible: true };
      }

      return visibleText(escapeMarkup(line));
    }

    return formatFallbackTrack(state.track, fallbackMode);
  }

  if (state.kind === 'track') {
    return formatFallbackTrack(state.track, fallbackMode);
  }

  if (state.kind === 'loading') {
    const trackText = formatTrackText(state.track);
    if (trackText === null) {
      return visibleText(escapeMarkup(DEFAULT_LOADING_PREFIX));
    }

    return visibleText(`${escapeMarkup(DEFAULT_LOADING_PREFIX)}: ${escapeMarkup(trackText)}`);
  }

  if (state.kind === 'error') {
    if (fallbackMode === 'hidden') {
      return hiddenText();
    }

    if (fallbackMode === 'track') {
      return formatFallbackTrack(state.track, fallbackMode);
    }

    return visibleText(escapeMarkup(DEFAULT_ERROR_TEXT));
  }

  return fallbackMode === 'hidden' ? hiddenText() : visibleText(escapeMarkup(DEFAULT_IDLE_TEXT));
}

/**
 * @param {DisplayTrack | null | undefined} track
 * @param {FallbackMode} fallbackMode
 * @returns {DisplayText}
 */
function formatFallbackTrack(track, fallbackMode) {
  if (fallbackMode === 'hidden') {
    return hiddenText();
  }

  if (fallbackMode === 'idle') {
    return visibleText(escapeMarkup(DEFAULT_IDLE_TEXT));
  }

  return visibleText(escapeMarkup(formatTrackText(track) ?? UNKNOWN_TRACK_TEXT));
}

/**
 * @param {DisplayTrack | null | undefined} track
 * @returns {string | null}
 */
export function formatTrackText(track) {
  const title = normalizeText(track?.title);
  if (title !== '') {
    return title;
  }

  const artist = normalizeText(track?.artist);
  if (artist !== '') {
    return artist;
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} text
 * @returns {DisplayText}
 */
function visibleText(text) {
  return { text, visible: true };
}

/**
 * @returns {DisplayText}
 */
function hiddenText() {
  return { text: '', visible: false };
}
