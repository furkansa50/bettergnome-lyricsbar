/**
 * @typedef {'left' | 'center' | 'right'} PanelPosition
 * @typedef {'left' | 'center' | 'right'} TextAlign
 * @typedef {'track' | 'idle' | 'hidden'} FallbackMode
 * @typedef {'auto' | 'spotify' | 'youtube-music' | 'apple-music' | 'generic'} BrowserPlayerService
 * @typedef {'musixmatch' | 'better-lyrics' | 'lrclib'} LyricsSource
 * @typedef {'default' | 'system' | 'white' | 'black' | 'custom'} TextColorMode
 *
 * @typedef {Readonly<{
 *   panelPosition?: unknown,
 *   maxWidth?: unknown,
 *   textAlign?: unknown,
 *   fallbackMode?: unknown,
 *   showSettingsIcon?: unknown,
 *   hideWhenIdle?: unknown,
 *   playerPriority?: unknown,
 *   browserPlayerService?: unknown,
 *   lyricsSource?: unknown,
 *   cacheEnabled?: unknown,
 *   debugLogging?: unknown,
 *   textColorMode?: unknown,
 *   customTextColor?: unknown,
 *   textShadowEnabled?: unknown,
 *   glowStrength?: unknown,
 *   autoWidth?: unknown,
 * }>} RawSettings
 *
 * @typedef {Readonly<{
 *   panelPosition: PanelPosition,
 *   maxWidth: number,
 *   textAlign: TextAlign,
 *   fallbackMode: FallbackMode,
 *   showSettingsIcon: boolean,
 *   hideWhenIdle: boolean,
 *   playerPriority: readonly string[],
 *   browserPlayerService: BrowserPlayerService,
 *   lyricsSource: LyricsSource,
 *   cacheEnabled: boolean,
 *   debugLogging: boolean,
 *   textColorMode: TextColorMode,
 *   customTextColor: string,
 *   textShadowEnabled: boolean,
 *   glowStrength: number,
 *   autoWidth: boolean,
 * }>} LyricBarSettings
 */

export {};
