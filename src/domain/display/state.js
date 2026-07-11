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
 * @returns {DisplayText}
 */
export function formatDisplayState(state, fallbackMode) {
  if (state.kind === 'hidden') {
    return hiddenText();
  }

  if (state.kind === 'lyrics') {
    const line = normalizeText(state.line);
    if (line !== '') {
      // If we have word-level timings and a valid highlighted word index
      if (state.words && state.words.length > 0) {
        const wordMarkup = state.words.map(
          /**
           * @param {import('../lyrics/types.js').WordTiming} w
           * @param {number} idx
           */
          (w, idx) => {
            const escapedWord = escapeMarkup(w.text);
            if (idx === state.activeWordIndex) {
              // Active word: bold
              return `<span weight="bold">${escapedWord}</span>`;
            }
            // Inactive words: translucent/dimmed
            return `<span alpha="35%">${escapedWord}</span>`;
          },
        );
        return { text: wordMarkup.join(' '), visible: true };
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
  const artist = normalizeText(track?.artist);
  const title = normalizeText(track?.title);

  if (artist !== '' && title !== '') {
    return `${artist} - ${title}`;
  }

  if (title !== '') {
    return title;
  }

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
