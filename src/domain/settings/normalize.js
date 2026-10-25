import {
  DEFAULT_CUSTOM_TEXT_COLOR,
  DEFAULT_TEXT_COLOR_MODE,
  DEFAULT_TEXT_SHADOW_ENABLED,
  isHexColor,
  isTextColorMode,
} from './appearance.js';

const DEFAULT_PANEL_POSITION = 'center';
const DEFAULT_MAX_WIDTH = 720;
const MIN_MAX_WIDTH = 120;
const MAX_MAX_WIDTH = 720;
const DEFAULT_FALLBACK_MODE = 'track';
const DEFAULT_PLAYER_PRIORITY = ['spotify'];
const DEFAULT_BROWSER_PLAYER_SERVICE = 'auto';
const DEFAULT_LYRICS_SOURCE = 'musixmatch';
const DEFAULT_TEXT_ALIGN = 'left';
const DEFAULT_AUTO_WIDTH = true;
const DEFAULT_HIDE_WHEN_IDLE = true;
const DEFAULT_GLOW_STRENGTH = 1.0;
const MIN_GLOW_STRENGTH = 0.0;
const MAX_GLOW_STRENGTH = 2.0;
const DEFAULT_SYNC_OFFSET_MS = 0;
const MIN_SYNC_OFFSET_MS = -5000;
const MAX_SYNC_OFFSET_MS = 5000;

const PANEL_POSITIONS = new Set(['left', 'center', 'right']);
const FALLBACK_MODES = new Set(['track', 'idle', 'hidden']);
const BROWSER_PLAYER_SERVICES = new Set([
  'auto',
  'spotify',
  'youtube-music',
  'apple-music',
  'generic',
]);
const LYRICS_SOURCES = new Set(['musixmatch', 'better-lyrics', 'lrclib']);
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);

/**
 * @import {
 *   BrowserPlayerService,
 *   FallbackMode,
 *   LyricBarSettings,
 *   LyricsSource,
 *   PanelPosition,
 *   RawSettings,
 *   TextAlign,
 *   TextColorMode,
 * } from './types.js'
 */

/**
 * @param {RawSettings} raw
 * @returns {LyricBarSettings}
 */
export function normalizeSettings(raw) {
  return {
    panelPosition: normalizePanelPosition(raw.panelPosition),
    maxWidth: normalizeMaxWidth(raw.maxWidth),
    textAlign: normalizeTextAlign(raw.textAlign),
    fallbackMode: normalizeFallbackMode(raw.fallbackMode),
    showSettingsIcon: normalizeBoolean(raw.showSettingsIcon, true),
    hideWhenIdle: normalizeBoolean(raw.hideWhenIdle, DEFAULT_HIDE_WHEN_IDLE),
    playerPriority: normalizePlayerPriority(raw.playerPriority),
    browserPlayerService: normalizeBrowserPlayerService(raw.browserPlayerService),
    lyricsSource: normalizeLyricsSource(raw.lyricsSource),
    musixmatchToken: normalizeMusixmatchToken(raw.musixmatchToken),
    cacheEnabled: normalizeBoolean(raw.cacheEnabled, true),
    debugLogging: normalizeBoolean(raw.debugLogging, false),
    textColorMode: normalizeTextColorMode(raw.textColorMode),
    customTextColor: normalizeCustomTextColor(raw.customTextColor),
    textShadowEnabled: normalizeBoolean(raw.textShadowEnabled, DEFAULT_TEXT_SHADOW_ENABLED),
    glowStrength: normalizeGlowStrength(raw.glowStrength),
    autoWidth: normalizeBoolean(raw.autoWidth, DEFAULT_AUTO_WIDTH),
    syncOffsetMs: normalizeSyncOffsetMs(raw.syncOffsetMs),
  };
}

/**
 * @param {unknown} value
 * @returns {PanelPosition}
 */
export function normalizePanelPosition(value) {
  return typeof value === 'string' && PANEL_POSITIONS.has(value)
    ? /** @type {PanelPosition} */ (value)
    : DEFAULT_PANEL_POSITION;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeMaxWidth(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_WIDTH;
  }

  const rounded = Math.round(/** @type {number} */ (value));
  return Math.min(MAX_MAX_WIDTH, Math.max(MIN_MAX_WIDTH, rounded));
}

/**
 * @param {unknown} value
 * @returns {FallbackMode}
 */
export function normalizeFallbackMode(value) {
  return typeof value === 'string' && FALLBACK_MODES.has(value)
    ? /** @type {FallbackMode} */ (value)
    : DEFAULT_FALLBACK_MODE;
}

/**
 * @param {unknown} value
 * @returns {readonly string[]}
 */
export function normalizePlayerPriority(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_PLAYER_PRIORITY;
  }

  const normalized = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');

  return [...new Set(normalized)];
}

/**
 * @param {unknown} value
 * @returns {BrowserPlayerService}
 */
export function normalizeBrowserPlayerService(value) {
  return typeof value === 'string' && BROWSER_PLAYER_SERVICES.has(value)
    ? /** @type {BrowserPlayerService} */ (value)
    : DEFAULT_BROWSER_PLAYER_SERVICE;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {TextAlign}
 */
export function normalizeTextAlign(value) {
  return typeof value === 'string' && TEXT_ALIGNS.has(value)
    ? /** @type {TextAlign} */ (value)
    : DEFAULT_TEXT_ALIGN;
}

/**
 * @param {unknown} value
 * @returns {TextColorMode}
 */
export function normalizeTextColorMode(value) {
  return isTextColorMode(value) ? value : DEFAULT_TEXT_COLOR_MODE;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCustomTextColor(value) {
  return isHexColor(value) ? value.trim() : DEFAULT_CUSTOM_TEXT_COLOR;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeGlowStrength(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GLOW_STRENGTH;
  }
  return Math.min(MAX_GLOW_STRENGTH, Math.max(MIN_GLOW_STRENGTH, value));
}

/**
 * @param {unknown} value
 * @returns {LyricsSource}
 */
export function normalizeLyricsSource(value) {
  return typeof value === 'string' && LYRICS_SOURCES.has(value)
    ? /** @type {LyricsSource} */ (value)
    : DEFAULT_LYRICS_SOURCE;
}

// Musixmatch no longer issues anonymous tokens; users paste the token of their
// logged-in musixmatch.com session. Accept the bare token, the raw
// `musixmatchUserToken` cookie value (URL-encoded JSON mapping app ids to
// tokens) or an HTML snippet embedding `"userToken":"..."`.
const MUSIXMATCH_TOKEN_RE = /^[\w-]{16,}$/;
const MUSIXMATCH_APP_ID_PREFERENCE = ['mxm-com-v1.0', 'web-desktop-app-v1.0'];

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMusixmatchToken(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.trim();
  if (text === '') {
    return '';
  }

  if (isMusixmatchToken(text)) {
    return text;
  }

  const embedded = /userToken"?\s*[:=]\s*"([\w-]{16,})"/.exec(text);
  if (embedded?.[1] && isMusixmatchToken(embedded[1])) {
    return embedded[1];
  }

  const decoded = decodeMusixmatchBlob(text);
  const found = collectMusixmatchTokens(decoded);
  const preferred = [...MUSIXMATCH_APP_ID_PREFERENCE, ...found.map((entry) => entry.key)];
  for (const key of preferred) {
    const match = found.find((entry) => entry.key === key);
    if (match) {
      return match.token;
    }
  }
  return found[0]?.token ?? '';
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isMusixmatchToken(value) {
  return MUSIXMATCH_TOKEN_RE.test(value) && !/^0+$/.test(value);
}

/**
 * Repeatedly URL-decodes / JSON-parses a pasted blob until it stops changing,
 * mirroring how musixmatch.com nests the cookie value.
 *
 * @param {string} raw
 * @returns {unknown}
 */
function decodeMusixmatchBlob(raw) {
  let value = /** @type {unknown} */ (raw);
  for (let round = 0; round < 4; round += 1) {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      const urlDecoded = decodeURIComponent(value);
      if (urlDecoded !== value) {
        value = urlDecoded;
        continue;
      }
    } catch {
      // not URL-encoded
    }
    try {
      const jsonDecoded = JSON.parse(/** @type {string} */ (value));
      if (jsonDecoded !== value) {
        value = jsonDecoded;
        continue;
      }
    } catch {
      // not JSON
    }
    break;
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {{ key: string, token: string }[]} out
 * @param {number} depth
 * @returns {{ key: string, token: string }[]}
 */
function collectMusixmatchTokens(value, key = '', out = [], depth = 0) {
  if (depth > 8) {
    return out;
  }
  if (typeof value === 'string') {
    if (isMusixmatchToken(value)) {
      out.push({ key, token: value });
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMusixmatchTokens(item, key, out, depth + 1);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectMusixmatchTokens(childValue, childKey, out, depth + 1);
    }
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSyncOffsetMs(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SYNC_OFFSET_MS;
  }
  const rounded = Math.round(/** @type {number} */ (value));
  return Math.min(MAX_SYNC_OFFSET_MS, Math.max(MIN_SYNC_OFFSET_MS, rounded));
}
