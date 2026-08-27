/**
 * Panel-visibility policy for the top-bar lyrics label.
 *
 * The lyrics bar is a music affordance, not a permanent status icon: when no
 * music player is active there is nothing for it to say, and a placeholder in
 * the top bar is pure clutter. This module decides when the label should be
 * hidden outright, independently of what text the display state would produce.
 *
 * @import { PlayerSnapshot } from '../mpris/types.js'
 *
 * @typedef {Readonly<{
 *   hideWhenIdle: boolean,
 *   player?: PlayerSnapshot | null | undefined,
 * }>} IndicatorVisibilityInput
 */

/**
 * Whether an MPRIS player counts as "currently in use".
 *
 * `Stopped` is treated as not in use: browser MPRIS clients keep advertising a
 * stopped player long after playback ended, and desktop players sit in that
 * state while idle. Paused counts as in use, because the user is still working
 * inside the player and a bar that vanishes on every pause is worse than one
 * that stays.
 *
 * @param {PlayerSnapshot | null | undefined} player
 * @returns {boolean}
 */
export function isActiveMusicPlayer(player) {
  if (player === null || player === undefined) {
    return false;
  }

  return player.playbackStatus === 'Playing' || player.playbackStatus === 'Paused';
}

/**
 * Whether the panel label should be hidden entirely.
 *
 * @param {IndicatorVisibilityInput} input
 * @returns {boolean}
 */
export function shouldHideIndicator(input) {
  if (input.hideWhenIdle !== true) {
    return false;
  }

  return !isActiveMusicPlayer(input.player);
}
