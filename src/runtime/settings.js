import { normalizeSettings } from '../domain/settings/normalize.js';

/**
 * @import { LyricBarSettings } from '../domain/settings/types.js'
 * @import { LifecycleRegistry } from './lifecycle.js'
 *
 * @typedef {Readonly<{
 *   get_string(key: string): string,
 *   set_string(key: string, value: string): boolean,
 *   get_int(key: string): number,
 *   get_strv(key: string): string[],
 *   get_boolean(key: string): boolean,
 *   get_double(key: string): number,
 *   connect(signal: string, callback: () => void): number,
 *   disconnect(id: number): void,
 * }>} GSettingsBackend
 */

const SETTING_KEYS = [
  'panel-position',
  'max-width',
  'text-align',
  'fallback-mode',
  'show-settings-icon',
  'hide-when-idle',
  'player-priority',
  'browser-player-service',
  'lyrics-source',
  'cache-enabled',
  'debug-logging',
  'style-text-color-type',
  'style-text-color-custom',
  'style-text-shadow',
  'style-glow-strength',
];

export class SettingsAdapter {
  #settings;
  #lifecycle;

  /**
   * @param {GSettingsBackend} settings
   * @param {LifecycleRegistry} lifecycle
   */
  constructor(settings, lifecycle) {
    this.#settings = settings;
    this.#lifecycle = lifecycle;
  }

  /**
   * @returns {LyricBarSettings}
   */
  read() {
    return normalizeSettings({
      panelPosition: this.#settings.get_string('panel-position'),
      maxWidth: this.#settings.get_int('max-width'),
      textAlign: this.#settings.get_string('text-align'),
      fallbackMode: this.#settings.get_string('fallback-mode'),
      showSettingsIcon: this.#settings.get_boolean('show-settings-icon'),
      hideWhenIdle: this.#settings.get_boolean('hide-when-idle'),
      playerPriority: this.#settings.get_strv('player-priority'),
      browserPlayerService: this.#settings.get_string('browser-player-service'),
      lyricsSource: this.#settings.get_string('lyrics-source'),
      cacheEnabled: this.#settings.get_boolean('cache-enabled'),
      debugLogging: this.#settings.get_boolean('debug-logging'),
      textColorMode: this.#settings.get_string('style-text-color-type'),
      customTextColor: this.#settings.get_string('style-text-color-custom'),
      textShadowEnabled: this.#settings.get_boolean('style-text-shadow'),
      glowStrength: this.#settings.get_double('style-glow-strength'),
    });
  }

  /**
   * @param {import('../domain/settings/types.js').LyricsSource} source
   * @returns {void}
   */
  setLyricsSource(source) {
    this.#settings.set_string('lyrics-source', source);
  }

  /**
   * @param {(settings: LyricBarSettings) => void} callback
   * @returns {void}
   */
  subscribe(callback) {
    for (const key of SETTING_KEYS) {
      const signalId = this.#settings.connect(`changed::${key}`, () => {
        callback(this.read());
      });
      this.#lifecycle.addSignal(
        () => this.#settings,
        () => signalId,
      );
    }
  }
}
