import { shouldUseSyncedLyricsTiming } from './sync-position-policy.js';

/**
 * @import { LyricsProviderResult } from '../lyrics/types.js'
 * @import { PlayerSnapshot } from '../mpris/types.js'
 * @import { BrowserPlayerService } from '../settings/types.js'
 */

/**
 * Browser MPRIS implementations can expose a valid, advancing Position while
 * PlaybackStatus is missing, stale, or late. Once synced lyrics exist, the
 * position read itself is the reliable source of truth; paused or stopped
 * players are cheap to poll because stable positions do not trigger line
 * changes.
 *
 * @param {{
 *   enabled: boolean,
 *   player: PlayerSnapshot | null,
 *   lookup: LyricsProviderResult | null,
 *   browserPlayerService?: BrowserPlayerService | null | undefined,
 * }} state
 * @returns {boolean}
 */
export function shouldPollSyncedLyrics(state) {
  return (
    state.enabled &&
    state.player !== null &&
    state.lookup?.kind === 'synced' &&
    shouldUseSyncedLyricsTiming(state.player, {
      browserPlayerService: state.browserPlayerService ?? 'auto',
    })
  );
}

/**
 * The details popup shows a live clock and progress bar for whatever is
 * playing, including tracks with no synced lyrics and players with no
 * recognized profile. Position must therefore be polled independently of
 * {@link shouldPollSyncedLyrics}.
 *
 * Only advancing players qualify: a paused or stopped position does not move,
 * so the last value already on screen stays correct and the poll would be pure
 * D-Bus traffic.
 *
 * @param {{
 *   enabled: boolean,
 *   player: PlayerSnapshot | null,
 * }} state
 * @returns {boolean}
 */
export function shouldPollPlayerPosition(state) {
  return state.enabled && state.player !== null && state.player.playbackStatus === 'Playing';
}
