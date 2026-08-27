import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
  displayStateFromLookup,
  displayStateFromSyncedPosition,
  selectSyncedHighlight,
} from '../domain/display/lyrics-state.js';
import { displayStateFromPlayer } from '../domain/display/player-state.js';
import {
  shouldHoldLowConfidenceSyncedPosition,
  shouldUseRelativeSyncedLyricsPosition,
  shouldUseSyncedLyricsPosition,
} from '../domain/display/sync-position-policy.js';
import { updateStagnantSyncedPositionEstimate } from '../domain/display/sync-position-estimator.js';
import {
  shouldPollPlayerPosition,
  shouldPollSyncedLyrics,
} from '../domain/display/sync-polling.js';
import {
  estimatePositionMs,
  isPositionClockAdvancing,
  retargetPositionClock,
  setPositionClockAdvancing,
  syncPositionClock,
} from '../domain/display/position-clock.js';
import { shouldHideIndicator } from '../domain/display/visibility.js';
import { buildIndicatorViewModel } from '../domain/display/view-model.js';
import { computeTargetSetPositionMs } from '../domain/display/track-progress.js';
import { selectLyricLineIndex } from '../domain/lyrics/lrc.js';
import { selectActivePlayer } from '../domain/mpris/selection.js';
import {
  shouldRefreshLyricsQuery,
  shouldRefreshPlayerSelection,
  shouldRefreshSettingsAccess,
  shouldRepositionPanelIndicator,
} from '../domain/settings/change.js';
import { LyricBarIndicator, LyricBarSettingsIndicator } from '../shell/indicator.js';
import { normalizePanelPosition } from '../domain/settings/normalize.js';
import { LifecycleRegistry } from './lifecycle.js';
import { LyricsCache } from './lyrics/cache.js';
import { BetterLyricsProvider } from './lyrics/better-lyrics.js';
import { LyricsService } from './lyrics/service.js';
import { RuntimeLogger } from './logger.js';
import { MprisService } from './mpris/service.js';
import { PlayerProxy } from './mpris/player.js';
import { StablePlayerProxy } from './mpris/stable-player.js';
import { SettingsAdapter } from './settings.js';

/**
 * @import { DisplayState } from '../domain/display/types.js'
 * @import { IndicatorViewModel } from '../domain/display/view-model.js'
 * @import { LyricsProviderResult } from '../domain/lyrics/types.js'
 * @import { PlayerSnapshot } from '../domain/mpris/types.js'
 * @import { LyricBarSettings } from '../domain/settings/types.js'
 * @import { StagnantSyncedPositionEstimate } from '../domain/display/sync-position-estimator.js'
 * @import { PositionClock } from '../domain/display/position-clock.js'
 * @import { GSettingsBackend } from './settings.js'
 *
 * @typedef {Readonly<{
 *   uuid: string,
 *   getSettings(): GSettingsBackend,
 *   openPreferences(): void,
 * }>} ExtensionHandle
 *
 * @typedef {Readonly<{
 *   render(viewModel: IndicatorViewModel): void,
 *   setDetailsActions(actions: import('../shell/details-menu.js').DetailsMenuActions): void,
 *   renderDetails(state: import('../shell/details-menu.js').DetailsMenuState): void,
 *   destroy(): void,
 * }>} IndicatorHandle
 *
 * @typedef {{
 *   proxy: StablePlayerProxy,
 *   lifecycle: LifecycleRegistry,
 * }} TrackedProxy
 */

/**
 * Cadence of the MPRIS `Position` read.
 *
 * Each tick is a D-Bus round trip, so this stays coarse; it only has to
 * re-anchor the local clock often enough to correct drift and to notice
 * external seeks on players that do not emit `Seeked`.
 */
const POSITION_POLL_INTERVAL_MS = 500;

/**
 * Cadence of the local word-highlight tick.
 *
 * Words last roughly 150-400 ms, so a 500 ms clock cannot place a per-word
 * highlight: it lands up to a full interval late and skips words entirely.
 * This tick does no I/O -- it interpolates the last sampled position and
 * re-renders only when the highlight actually moves.
 */
const WORD_TICK_INTERVAL_MS = 40;

const FIREFOX_STAGNANT_POSITION_THRESHOLD_MS = 2_500;

/** Offset applied by the rewind and fast-forward controls. */
const SEEK_STEP_MS = 10_000;

export class LyricBarController {
  /** @type {ExtensionHandle} */
  #extension;

  /** @type {IndicatorHandle | null} */
  #indicator = null;

  /** @type {(() => void) | null} */
  #destroyIndicator = null;

  /** @type {any | null} */
  #settingsIndicator = null;

  /** @type {(() => void) | null} */
  #destroySettingsIndicator = null;

  /** @type {LifecycleRegistry | null} */
  #lifecycle = null;

  /** @type {SettingsAdapter | null} */
  #settings = null;

  /** @type {RuntimeLogger | null} */
  #logger = null;

  /** @type {LyricBarSettings | null} */
  #currentSettings = null;

  /** @type {DisplayState} */
  #displayState = { kind: 'idle' };

  /** @type {boolean} */
  #enabled = false;

  /** @type {any} */
  #connection = null;

  /** @type {MprisService | null} */
  #mprisService = null;

  /** @type {Map<string, TrackedProxy>} */
  #proxies = new Map();

  /** @type {string | null} */
  #lastSelectedBusName = null;

  /** @type {LyricsService | null} */
  #lyricsService = null;

  /** @type {PlayerSnapshot | null} */
  #activePlayer = null;

  /** @type {LyricsProviderResult | null} */
  #currentLookup = null;

  /** @type {number} */
  #syncSourceId = 0;

  /**
   * Local word-highlight tick. Separate from the position poll so the highlight
   * can advance without generating D-Bus traffic.
   *
   * @type {number}
   */
  #wordTickSourceId = 0;

  /** @type {string | null} */
  #lastSyncedLine = null;

  /** @type {number} */
  #lastActiveWordIndex = -1;

  /**
   * Cheap fingerprint of the last rendered selection indices.
   *
   * The word tick fires far more often than the highlight actually moves, so
   * this is compared before any display state is rebuilt.
   *
   * @type {string | null}
   */
  #lastHighlightKey = null;

  /**
   * Interpolated playback clock, re-anchored by every accepted position sample.
   *
   * @type {PositionClock | null}
   */
  #positionClock = null;

  /**
   * Subject the sync loop is currently following. A change means the loop must
   * resync immediately instead of waiting for its next scheduled tick.
   *
   * @type {string | null}
   */
  #syncSubjectKey = null;

  /** @type {number | null} */
  #lastKnownPositionMs = null;

  /**
   * Identity of the track `#lastKnownPositionMs` belongs to. Used to drop the
   * cached position when the popup's subject changes, so the progress bar does
   * not keep showing the previous track's elapsed time.
   *
   * @type {string | null}
   */
  #lastPositionTrackKey = null;

  /** @type {string | null} */
  #syncPositionTrackKey = null;

  /** @type {number | null} */
  #syncPositionOffsetMs = null;

  /** @type {number | null} */
  #lastAcceptedSyncPositionMs = null;

  /** @type {StagnantSyncedPositionEstimate | null} */
  #syncPositionEstimate = null;

  /**
   * @param {ExtensionHandle} extension
   */
  constructor(extension) {
    this.#extension = extension;
  }

  /**
   * @returns {boolean}
   */
  get enabled() {
    return this.#enabled;
  }

  /**
   * @returns {void}
   */
  enable() {
    if (this.#enabled) {
      return;
    }

    this.#enabled = true;
    this.#lifecycle = new LifecycleRegistry();
    this.#lifecycle.addSource(
      () => this.#syncSourceId,
      (id) => GLib.source_remove(id),
    );
    this.#lifecycle.addSource(
      () => this.#wordTickSourceId,
      (id) => GLib.source_remove(id),
    );
    this.#settings = new SettingsAdapter(this.#extension.getSettings(), this.#lifecycle);
    this.#currentSettings = this.#settings.read();
    this.#logger = new RuntimeLogger(
      'LyricBar',
      () => this.#currentSettings?.debugLogging === true,
    );
    this.#logger.debug('controller-enable', { uuid: this.#extension.uuid });
    this.#settings.subscribe((settings) => {
      const previousSettings = this.#currentSettings;
      this.#currentSettings = settings;
      this.#logger?.debug('settings-changed', {
        browserPlayerService: settings.browserPlayerService,
        debugLogging: settings.debugLogging,
        maxWidth: settings.maxWidth,
        panelPosition: settings.panelPosition,
        showSettingsIcon: settings.showSettingsIcon,
      });
      if (previousSettings !== null && shouldRepositionPanelIndicator(previousSettings, settings)) {
        this.#logger?.debug('indicator-reposition-requested', {
          from: previousSettings.panelPosition,
          to: settings.panelPosition,
        });
        this.#replaceIndicator();
      }
      if (previousSettings !== null && shouldRefreshSettingsAccess(previousSettings, settings)) {
        this.#syncSettingsAccess();
      }
      if (previousSettings !== null && shouldRefreshLyricsQuery(previousSettings, settings)) {
        this.#logger?.debug('lyrics-source-changed', {
          from: previousSettings.lyricsSource,
          to: settings.lyricsSource,
        });
        this.#lyricsService?.forceReload({ bypassCache: true });
      }
      if (previousSettings !== null && shouldRefreshPlayerSelection(previousSettings, settings)) {
        this.#refreshSelection();
        return;
      }
      this.#refreshDisplay();
    });

    this.#mountIndicator();
    this.#mountSettingsIndicator();

    this.#startLyricsService();
    this.#startMprisDiscovery();
  }

  /**
   * @returns {void}
   */
  disable() {
    if (!this.#enabled) {
      return;
    }

    this.#enabled = false;
    this.#logger?.debug('controller-disable');
    const lifecycle = this.#lifecycle;
    this.#lifecycle = null;
    this.#settings = null;
    this.#currentSettings = null;
    this.#mprisService = null;
    this.#connection = null;
    this.#proxies.clear();
    this.#lastSelectedBusName = null;
    this.#lyricsService = null;
    this.#activePlayer = null;
    this.#currentLookup = null;
    this.#stopSyncLoop();
    this.#lastKnownPositionMs = null;
    this.#lastPositionTrackKey = null;
    this.#positionClock = null;
    this.#syncSubjectKey = null;
    this.#displayState = { kind: 'idle' };
    lifecycle?.dispose();
    this.#indicator = null;
    this.#destroyIndicator = null;
    this.#settingsIndicator = null;
    this.#destroySettingsIndicator = null;
    this.#logger = null;
  }

  /**
   * @returns {void}
   */
  #replaceIndicator() {
    if (!this.#enabled) {
      return;
    }

    this.#logger?.debug('indicator-replace');
    this.#destroyIndicator?.();
    this.#destroyIndicator = null;
    this.#mountIndicator();
  }

  /**
   * @returns {void}
   */
  #mountIndicator() {
    const lifecycle = this.#lifecycle;
    if (lifecycle === null || this.#currentSettings === null) {
      return;
    }

    const indicator = /** @type {IndicatorHandle} */ (
      new LyricBarIndicator(this.#extension.getSettings())
    );
    let destroyed = false;
    this.#indicator = indicator;
    this.#destroyIndicator = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      indicator.destroy();
      if (this.#indicator === indicator) {
        this.#indicator = null;
      }
    };

    Main.panel.addToStatusArea(
      this.#extension.uuid,
      indicator,
      0,
      normalizePanelPosition(this.#currentSettings.panelPosition),
    );
    this.#logger?.debug('indicator-mounted', {
      panelPosition: this.#currentSettings.panelPosition,
    });
    this.#wireDetailsActions(indicator);
    this.#render();
    this.#renderDetails();
    lifecycle.add(this.#destroyIndicator);
  }

  /**
   * @returns {void}
   */
  #mountSettingsIndicator() {
    const lifecycle = this.#lifecycle;
    if (
      lifecycle === null ||
      this.#currentSettings?.showSettingsIcon !== true ||
      this.#settingsIndicator !== null
    ) {
      return;
    }

    const settingsIndicator = new LyricBarSettingsIndicator(
      this.#extension.getSettings(),
      this.#extension,
    );
    let destroyed = false;
    this.#settingsIndicator = settingsIndicator;
    this.#destroySettingsIndicator = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      settingsIndicator.destroy();
      if (this.#settingsIndicator === settingsIndicator) {
        this.#settingsIndicator = null;
      }
    };

    Main.panel.addToStatusArea(`${this.#extension.uuid}-settings`, settingsIndicator, 0, 'right');
    this.#logger?.debug('settings-indicator-mounted');
    lifecycle.add(this.#destroySettingsIndicator);
  }

  /**
   * @returns {void}
   */
  #unmountSettingsIndicator() {
    this.#destroySettingsIndicator?.();
    this.#destroySettingsIndicator = null;
  }

  /**
   * @returns {void}
   */
  #syncSettingsAccess() {
    if (this.#currentSettings?.showSettingsIcon === true) {
      this.#mountSettingsIndicator();
      return;
    }
    this.#unmountSettingsIndicator();
  }

  /**
   * Wire the playback control actions from the active player proxy into the
   * indicator's details popup. Called once per indicator mount.
   *
   * @param {IndicatorHandle} indicator
   * @returns {void}
   */
  #wireDetailsActions(indicator) {
    if (typeof indicator.setDetailsActions !== 'function') {
      return;
    }

    indicator.setDetailsActions({
      onPlayPause: () => this.#invokePlayerControl((proxy) => proxy.playPause()),
      onNext: () => this.#invokePlayerControl((proxy) => proxy.next()),
      onPrevious: () => this.#invokePlayerControl((proxy) => proxy.previous()),
      onSeek: (positionMs) => this.#seekToPosition(positionMs),
      onSeekBy: (offsetMs) => this.#seekByOffset(offsetMs),
      onSelectLyricsSource: (source) => this.#setLyricsSource(source),
    });
  }

  /**
   * @param {import('../domain/settings/types.js').LyricsSource} source
   * @returns {void}
   */
  #setLyricsSource(source) {
    this.#settings?.setLyricsSource(source);
    this.#lyricsService?.forceReload({ bypassCache: true });
  }

  /**
   * Seek to an absolute position, e.g. a progress-bar click.
   *
   * `SetPosition` is preferred because it is exact, but it requires a valid
   * `mpris:trackid`; players that do not publish one are seeked relative to the
   * current estimate instead, which is the difference between a working control
   * and a click that silently does nothing.
   *
   * @param {number} positionMs
   * @returns {void}
   */
  #seekToPosition(positionMs) {
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
      return;
    }

    const trackId = this.#activePlayer?.trackId ?? null;
    this.#invokePlayerControl((proxy) => {
      if (!proxy.canSeek) {
        this.#logger?.debug('seek-rejected', { reason: 'player-reports-can-seek-false' });
        return;
      }

      // Prefer relative Seek(positionMs - currentMs) when current position is known.
      // Many MPRIS players (notably Spotify Desktop and Chromium) either do not
      // implement SetPosition or erroneously restart the track from 0:00 when
      // SetPosition is called, whereas Seek(offset) is universally supported.
      const currentMs = this.#currentPositionMs();
      if (currentMs !== null) {
        proxy.seek(positionMs - currentMs);
      } else if (typeof trackId === 'string' && trackId !== '') {
        const targetMs = computeTargetSetPositionMs(positionMs, this.#syncPositionOffsetMs);
        proxy.setPosition(trackId, targetMs);
      }

      this.#applyOptimisticSeek(positionMs);
    });
  }

  /**
   * Seek relative to the current position, i.e. rewind and fast-forward.
   *
   * @param {number} offsetMs Signed offset in milliseconds.
   * @returns {void}
   */
  #seekByOffset(offsetMs) {
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs) || offsetMs === 0) {
      return;
    }

    this.#invokePlayerControl((proxy) => {
      if (!proxy.canSeek) {
        this.#logger?.debug('seek-rejected', { reason: 'player-reports-can-seek-false' });
        return;
      }

      proxy.seek(offsetMs);

      const currentMs = this.#currentPositionMs();
      if (currentMs === null) {
        return;
      }

      const durationMs = this.#activePlayer?.durationMs ?? null;
      const target = Math.max(0, currentMs + offsetMs);
      this.#applyOptimisticSeek(
        typeof durationMs === 'number' && durationMs > 0 ? Math.min(target, durationMs) : target,
      );
    });
  }

  /**
   * Move the local clock and the visible state to a just-requested position.
   *
   * The player's own report is up to a poll interval away, so without this the
   * lyric line and progress bar keep showing the pre-seek position and then
   * snap, which reads as a broken control.
   *
   * @param {number} positionMs
   * @returns {void}
   */
  #applyOptimisticSeek(positionMs) {
    this.#positionClock = retargetPositionClock(this.#positionClock, positionMs, monotonicNowMs());
    this.#lastKnownPositionMs = positionMs;
    this.#lastAcceptedSyncPositionMs = positionMs;
    this.#syncPositionEstimate = null;
    this.#renderSyncedPosition(positionMs);
    this.#renderDetails();
  }

  /**
   * Handle a `Seeked` signal from a player.
   *
   * @param {string} busName
   * @param {number} positionMs
   * @returns {void}
   */
  #handleSeeked(busName, positionMs) {
    if (!this.#enabled || this.#activePlayer?.busName !== busName) {
      return;
    }

    const normalizedMs = this.#normalizeSeekedPosition(positionMs);
    if (normalizedMs === null) {
      return;
    }

    this.#positionClock = retargetPositionClock(
      this.#positionClock,
      normalizedMs,
      monotonicNowMs(),
    );
    this.#lastKnownPositionMs = normalizedMs;
    this.#lastAcceptedSyncPositionMs = normalizedMs;
    this.#syncPositionEstimate = null;
    this.#renderSyncedPosition(normalizedMs);
    this.#renderDetails();
  }

  /**
   * Apply the same normalization the poll path applies, so a `Seeked` payload
   * from a player with a cumulative media-session clock is not taken literally.
   *
   * @param {number} positionMs
   * @returns {number | null}
   */
  #normalizeSeekedPosition(positionMs) {
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
      return null;
    }

    if (this.#syncPositionOffsetMs === null) {
      return positionMs;
    }

    return Math.max(0, positionMs - this.#syncPositionOffsetMs);
  }

  /**
   * Best current position: the interpolated clock when it is usable, otherwise
   * the last sampled value.
   *
   * @returns {number | null}
   */
  #currentPositionMs() {
    const estimated = estimatePositionMs(
      this.#positionClock,
      monotonicNowMs(),
      this.#activePositionTrackKey(),
    );
    return estimated ?? this.#lastKnownPositionMs;
  }

  /**
   * @returns {string | null}
   */
  #activePositionTrackKey() {
    const player = this.#activePlayer;
    if (player === null) {
      return null;
    }
    return [player.busName, player.trackId, player.title, player.artist].join('|');
  }

  /**
   * Run a playback control method against the active player's proxy.
   * Silently no-ops when there is no active player.
   *
   * @param {(proxy: import('./mpris/stable-player.js').StablePlayerProxy) => void} fn
   * @returns {void}
   */
  #invokePlayerControl(fn) {
    if (this.#activePlayer === null) {
      return;
    }
    const tracked = this.#proxies.get(this.#activePlayer.busName);
    if (tracked === undefined) {
      return;
    }
    try {
      fn(tracked.proxy);
    } catch (error) {
      this.#logger?.debug('player-control-failed', {
        busName: this.#activePlayer.busName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * @returns {void}
   */
  #startLyricsService() {
    const lifecycle = this.#lifecycle;
    if (lifecycle === null) {
      return;
    }

    const logger = this.#logger?.child('lyrics');
    const provider = new BetterLyricsProvider(lifecycle, {
      getLyricsSource: () => this.#currentSettings?.lyricsSource ?? 'musixmatch',
      logger: logger?.child('better-lyrics'),
    });
    const cache = new LyricsCache(
      lifecycle,
      () => ({
        cacheEnabled: this.#currentSettings?.cacheEnabled ?? true,
      }),
      { logger: logger?.child('cache') },
    );

    this.#lyricsService = new LyricsService(lifecycle, provider, cache, {
      getBrowserPlayerService: () => this.#currentSettings?.browserPlayerService ?? 'auto',
      logger,
    });
    this.#lyricsService.onLookupChanged((player, lookup) => {
      if (!this.#enabled) {
        return;
      }
      this.#activePlayer = player;
      this.#currentLookup = lookup;
      this.#refreshDisplay();
      this.#updateSyncLoop();
    });
  }

  /**
   * @returns {void}
   */
  #startMprisDiscovery() {
    const lifecycle = this.#lifecycle;
    if (lifecycle === null) {
      return;
    }

    this.#connection = Gio.DBus.session;
    this.#mprisService = new MprisService(this.#connection, lifecycle, {
      logger: this.#logger?.child('mpris'),
    });
    this.#mprisService.onPlayersChanged((names) => {
      this.#syncPlayers(names);
    });
    this.#mprisService.start();
  }

  /**
   * @param {readonly string[]} names
   * @returns {void}
   */
  #syncPlayers(names) {
    if (!this.#enabled || this.#lifecycle === null || this.#connection === null) {
      return;
    }

    const next = new Set(names);
    this.#logger?.debug('players-sync', { count: names.length });
    for (const [busName, tracked] of this.#proxies) {
      if (!next.has(busName)) {
        tracked.lifecycle.dispose();
        this.#proxies.delete(busName);
      }
    }

    for (const busName of names) {
      if (this.#proxies.has(busName)) {
        continue;
      }
      this.#registerProxy(busName);
    }

    this.#refreshSelection();
  }

  /**
   * @param {string} busName
   * @returns {void}
   */
  #registerProxy(busName) {
    const parent = this.#lifecycle;
    if (parent === null || this.#connection === null) {
      return;
    }

    const child = new LifecycleRegistry();
    parent.add(child);

    const rawProxy = new PlayerProxy(this.#connection, busName, child, {
      logger: this.#logger?.child('player'),
    });
    const proxy = new StablePlayerProxy(rawProxy, child, {
      getBrowserPlayerService: () => this.#currentSettings?.browserPlayerService ?? 'auto',
      logger: this.#logger?.child('player') ?? null,
      schedule: scheduleTimeout,
    });
    proxy.onSnapshot(() => {
      this.#refreshPeerPlayerProperties(proxy.busName);
      this.#refreshSelection();
    });
    proxy.onSeeked((positionMs) => {
      this.#handleSeeked(busName, positionMs);
    });
    this.#proxies.set(busName, { proxy, lifecycle: child });
    proxy.start();
  }

  /**
   * @param {string} sourceBusName
   * @returns {void}
   */
  #refreshPeerPlayerProperties(sourceBusName) {
    for (const [busName, tracked] of this.#proxies) {
      if (busName !== sourceBusName) {
        tracked.proxy.refreshProperties();
      }
    }
  }

  /**
   * @returns {void}
   */
  #refreshSelection() {
    if (!this.#enabled || this.#currentSettings === null) {
      return;
    }

    /** @type {PlayerSnapshot[]} */
    const snapshots = [];
    for (const tracked of this.#proxies.values()) {
      const snapshot = tracked.proxy.snapshot();
      if (snapshot !== null) {
        snapshots.push(snapshot);
      }
    }

    const active = selectActivePlayer(
      snapshots,
      this.#lastSelectedBusName,
      this.#currentSettings.playerPriority,
    );

    if (active !== null) {
      this.#lastSelectedBusName = active.busName;
    }

    this.#logger?.debug('active-player-selected', {
      busName: active?.busName ?? null,
      playbackStatus: active?.playbackStatus ?? null,
      title: active?.title ?? null,
    });

    this.#activePlayer = active;
    this.#invalidateStalePosition();
    this.#syncClockAdvancing();
    if (this.#lyricsService !== null) {
      this.#lyricsService.setActivePlayer(active);
    } else {
      this.#refreshDisplay();
    }
    this.#updateSyncLoop();
  }

  /**
   * Keep the interpolated clock in step with playback state.
   *
   * A paused player's position does not move, so the clock must stop advancing;
   * otherwise the highlight keeps walking through the line while the music is
   * stopped and is wrong by the length of the pause on resume.
   *
   * @returns {void}
   */
  #syncClockAdvancing() {
    if (this.#positionClock === null) {
      return;
    }

    this.#positionClock = setPositionClockAdvancing(
      this.#positionClock,
      this.#activePlayer?.playbackStatus === 'Playing',
      monotonicNowMs(),
    );
  }

  /**
   * @returns {void}
   */
  #refreshDisplay() {
    if (!this.#enabled) {
      return;
    }

    this.#invalidateStalePosition();

    if (this.#activePlayer === null) {
      this.#displayState = displayStateFromPlayer(null);
    } else if (this.#currentLookup === null) {
      this.#displayState = displayStateFromPlayer(this.#activePlayer);
    } else {
      this.#displayState = displayStateFromLookup(this.#activePlayer, this.#currentLookup, {
        previousState: this.#displayState,
        // Without a position a synced lookup paints the song's first line, which
        // is wrong for any track already in progress.
        positionMs: this.#syncedPositionForFirstPaint(),
      });
    }

    this.#render();
    this.#renderDetails();
  }

  /**
   * Position to use for the first paint of a synced lookup, or null when none is
   * trustworthy yet.
   *
   * @returns {number | null}
   */
  #syncedPositionForFirstPaint() {
    if (this.#currentLookup?.kind !== 'synced') {
      return null;
    }

    return this.#currentPositionMs();
  }

  /**
   * Forget the cached position when it no longer describes the active track.
   *
   * @returns {void}
   */
  #invalidateStalePosition() {
    const key = this.#activePositionTrackKey();

    if (key === this.#lastPositionTrackKey) {
      return;
    }

    this.#lastPositionTrackKey = key;
    this.#lastKnownPositionMs = null;
    // The interpolated clock belongs to the previous track; keeping it would
    // extrapolate the old song's position onto the new one.
    this.#positionClock = null;
  }

  /**
   * Start or stop the position poll.
   *
   * The loop drives two consumers: synced-lyric line selection for the panel
   * label, and the elapsed clock plus progress bar in the details popup. Either
   * one is reason enough to keep polling.
   *
   * @returns {void}
   */
  #updateSyncLoop() {
    if (!this.#shouldPollPosition()) {
      this.#stopSyncLoop();
      return;
    }

    const subjectKey = this.#buildSyncSubjectKey();

    if (this.#syncSourceId === 0) {
      this.#resetSyncPositionOffset();
      this.#logger?.debug('sync-loop-start', {
        intervalMs: POSITION_POLL_INTERVAL_MS,
        title: this.#activePlayer?.title ?? null,
      });
      this.#syncSubjectKey = subjectKey;
      this.#resetHighlightMemo();
      this.#pollPosition();
      this.#syncSourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        POSITION_POLL_INTERVAL_MS,
        () => {
          if (!this.#shouldPollPosition()) {
            this.#logger?.debug('sync-loop-stop');
            this.#syncSourceId = 0;
            this.#resetHighlightMemo();
            this.#resetSyncPositionOffset();
            this.#stopWordTick();
            return GLib.SOURCE_REMOVE;
          }
          this.#pollPosition();
          return GLib.SOURCE_CONTINUE;
        },
      );
      this.#updateWordTick();
      return;
    }

    // Already polling. A new track or a newly arrived lookup must not wait for
    // the next scheduled tick: that delay is exactly the "lyrics appear late"
    // symptom when the loop was kept alive across a track change.
    if (subjectKey !== this.#syncSubjectKey) {
      this.#syncSubjectKey = subjectKey;
      this.#resetHighlightMemo();
      this.#logger?.debug('sync-loop-resync', { title: this.#activePlayer?.title ?? null });
      this.#pollPosition();
    }

    this.#updateWordTick();
  }

  /**
   * Identity of what the sync loop is currently following.
   *
   * The lookup is included by identity because the controller reuses one frozen
   * lookup object per track: a new object means new lyrics to paint.
   *
   * @returns {string | null}
   */
  #buildSyncSubjectKey() {
    const player = this.#activePlayer;
    if (player === null) {
      return null;
    }

    return [
      player.busName,
      player.trackId,
      player.title,
      player.artist,
      this.#currentLookup === null ? 'none' : this.#currentLookup.kind,
      this.#lookupGeneration(),
    ].join('\u0000');
  }

  /**
   * Stable per-lookup marker derived from object identity.
   *
   * @returns {string}
   */
  #lookupGeneration() {
    const lookup = this.#currentLookup;
    if (lookup === null) {
      return '0';
    }
    if (lookup.kind === 'synced') {
      return `${lookup.lines.length}:${lookup.wordLines?.length ?? 0}:${lookup.track.trackName}`;
    }
    return lookup.kind;
  }

  /**
   * Start, stop, or leave running the local word-highlight tick.
   *
   * @returns {void}
   */
  #updateWordTick() {
    if (!this.#shouldRunWordTick()) {
      this.#stopWordTick();
      return;
    }

    if (this.#wordTickSourceId !== 0) {
      return;
    }

    this.#logger?.debug('word-tick-start', { intervalMs: WORD_TICK_INTERVAL_MS });
    this.#wordTickSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORD_TICK_INTERVAL_MS, () => {
      if (!this.#shouldRunWordTick()) {
        this.#logger?.debug('word-tick-stop');
        this.#wordTickSourceId = 0;
        return GLib.SOURCE_REMOVE;
      }
      this.#tickWordHighlight();
      return GLib.SOURCE_CONTINUE;
    });
  }

  /**
   * The tick only earns its keep when the active lookup carries word timings and
   * the player is actually advancing; otherwise the highlight cannot move.
   *
   * @returns {boolean}
   */
  #shouldRunWordTick() {
    if (!this.#enabled || this.#activePlayer === null) {
      return false;
    }

    if (this.#activePlayer.playbackStatus !== 'Playing') {
      return false;
    }

    // A clock whose anchor has gone stale returns a constant position, so the
    // tick could no longer change anything. That happens for a whole track when
    // the poll keeps rejecting samples, and spinning on it would burn the shell
    // main loop for nothing. Accepting a sample re-arms the tick.
    if (!isPositionClockAdvancing(this.#positionClock, monotonicNowMs())) {
      return false;
    }

    const lookup = this.#currentLookup;
    if (lookup === null || lookup.kind !== 'synced') {
      return false;
    }

    return (lookup.wordLines?.length ?? 0) > 0 && this.#shouldPollSyncedLyrics();
  }

  /**
   * Forget the memoized selection so the next position re-renders.
   *
   * @returns {void}
   */
  #resetHighlightMemo() {
    this.#lastSyncedLine = null;
    this.#lastActiveWordIndex = -1;
    this.#lastHighlightKey = null;
  }

  /**
   * @returns {void}
   */
  #stopWordTick() {
    if (this.#wordTickSourceId === 0) {
      return;
    }

    try {
      GLib.source_remove(this.#wordTickSourceId);
    } catch {
      // already removed by GLib
    }
    this.#logger?.debug('word-tick-stop');
    this.#wordTickSourceId = 0;
  }

  /**
   * Advance the word highlight from the interpolated clock.
   *
   * @returns {void}
   */
  #tickWordHighlight() {
    const positionMs = estimatePositionMs(
      this.#positionClock,
      monotonicNowMs(),
      this.#activePositionTrackKey(),
    );
    if (positionMs === null) {
      return;
    }

    this.#lastKnownPositionMs = positionMs;
    this.#renderSyncedPosition(positionMs);
  }

  /**
   * Recompute the panel state for a position and render only when the visible
   * line or highlighted word actually changed.
   *
   * @param {number} positionMs
   * @returns {void}
   */
  #renderSyncedPosition(positionMs) {
    const player = this.#activePlayer;
    const lookup = this.#currentLookup;
    if (player === null || lookup === null || lookup.kind !== 'synced') {
      return;
    }

    // Cheap check first: on most ticks the highlight has not moved, and the
    // selection indices alone decide that. Building the display state and its
    // per-word markup before this comparison did the full work and threw it
    // away several times per second.
    const highlight = selectSyncedHighlight(lookup, positionMs);
    const highlightKey = `${highlight.lineIndex}:${highlight.wordLineIndex}:${highlight.activeWordIndex}`;
    if (highlightKey === this.#lastHighlightKey) {
      return;
    }
    this.#lastHighlightKey = highlightKey;

    const next = displayStateFromSyncedPosition(player, lookup, positionMs);
    const line = next.kind === 'lyrics' ? next.line : null;
    const activeWordIndex = next.kind === 'lyrics' ? next.activeWordIndex : -1;

    if (line === this.#lastSyncedLine && activeWordIndex === this.#lastActiveWordIndex) {
      return;
    }

    if (line !== this.#lastSyncedLine) {
      this.#logger?.debug('sync-line-selected', { positionMs, text: line });
    }

    this.#lastSyncedLine = line;
    this.#lastActiveWordIndex = activeWordIndex;
    this.#displayState = next;
    this.#render();
  }

  /**
   * @returns {boolean}
   */
  #shouldPollPosition() {
    return (
      this.#shouldPollSyncedLyrics() ||
      shouldPollPlayerPosition({ enabled: this.#enabled, player: this.#activePlayer })
    );
  }

  /**
   * @returns {boolean}
   */
  #shouldPollSyncedLyrics() {
    return shouldPollSyncedLyrics({
      enabled: this.#enabled,
      player: this.#activePlayer,
      lookup: this.#currentLookup,
      browserPlayerService: this.#currentSettings?.browserPlayerService ?? 'auto',
    });
  }

  /**
   * @returns {void}
   */
  #stopSyncLoop() {
    if (this.#syncSourceId !== 0) {
      try {
        GLib.source_remove(this.#syncSourceId);
      } catch {
        // already removed by GLib
      }
      this.#logger?.debug('sync-loop-stop');
      this.#syncSourceId = 0;
    }
    this.#stopWordTick();
    this.#syncSubjectKey = null;
    this.#resetHighlightMemo();
    this.#resetSyncPositionOffset();
  }

  /**
   * Read the player position and update whatever depends on it.
   *
   * @returns {void}
   */
  #pollPosition() {
    const player = this.#activePlayer;
    if (player === null) {
      return;
    }

    const lookup = this.#currentLookup;
    const tracked = this.#proxies.get(player.busName);
    if (tracked === undefined) {
      return;
    }

    tracked.proxy.readPosition((positionMs) => {
      if (!this.#enabled || this.#activePlayer !== player || positionMs === null) {
        return;
      }

      const syncedLookup =
        lookup !== null && lookup.kind === 'synced' && this.#currentLookup === lookup
          ? lookup
          : null;

      if (syncedLookup === null || !this.#shouldPollSyncedLyrics()) {
        // No synced lyrics to advance: the position still feeds the popup's
        // elapsed clock and progress bar.
        const isHeldZero = shouldHoldLowConfidenceSyncedPosition(player, positionMs, {
          hasAcceptedSyncedPosition: this.#lastAcceptedSyncPositionMs !== null,
          hasPreviousSyncedLine: this.#lastSyncedLine !== null,
          trackDurationMs: player.durationMs,
        });

        if (!isHeldZero) {
          this.#lastKnownPositionMs = positionMs;
          this.#lastAcceptedSyncPositionMs = positionMs;
          this.#anchorPositionClock(player, positionMs, player.durationMs, tracked.proxy.rate);
        }
        this.#renderDetails();
        return;
      }

      const effectivePositionMs = this.#resolveSyncedPosition(player, syncedLookup, positionMs);
      if (effectivePositionMs === null) {
        const currentMs = this.#currentPositionMs();
        if (currentMs !== null) {
          this.#renderSyncedPosition(currentMs);
          this.#renderDetails();
        }
        return;
      }

      this.#anchorPositionClock(
        player,
        effectivePositionMs,
        player.durationMs ?? syncedLookup.track.durationMs,
        tracked.proxy.rate,
      );

      const renderPositionMs =
        estimatePositionMs(this.#positionClock, monotonicNowMs(), this.#activePositionTrackKey()) ??
        effectivePositionMs;

      this.#lastKnownPositionMs = renderPositionMs;
      this.#renderSyncedPosition(renderPositionMs);
      this.#updateWordTick();

      // The popup's clock and progress bar advance on every tick, not only when
      // the active line changes.
      this.#renderDetails();
    });
  }

  /**
   * Re-anchor the interpolated clock on a freshly accepted position sample.
   *
   * @param {PlayerSnapshot} player
   * @param {number} positionMs
   * @param {number | null} durationMs
   * @param {number} rate
   * @returns {void}
   */
  #anchorPositionClock(player, positionMs, durationMs, rate) {
    const trackKey = this.#activePositionTrackKey();
    if (trackKey === null) {
      return;
    }

    this.#positionClock = syncPositionClock(this.#positionClock, {
      trackKey,
      positionMs,
      nowMs: monotonicNowMs(),
      advancing: player.playbackStatus === 'Playing',
      rate,
      durationMs,
    });
  }

  /**
   * @param {PlayerSnapshot} player
   * @param {Extract<LyricsProviderResult, { kind: 'synced' }>} lookup
   * @param {number} rawPositionMs
   * @returns {number | null}
   */
  #resolveSyncedPosition(player, lookup, rawPositionMs) {
    const options = {
      browserPlayerService: this.#currentSettings?.browserPlayerService ?? 'auto',
      hasAcceptedSyncedPosition: this.#lastAcceptedSyncPositionMs !== null,
      hasPreviousSyncedLine: this.#lastSyncedLine !== null,
      trackDurationMs: player.durationMs ?? lookup.track.durationMs,
    };
    const trackKey = this.#buildSyncPositionTrackKey(player, lookup);

    if (this.#syncPositionTrackKey !== trackKey) {
      this.#syncPositionTrackKey = trackKey;
      this.#syncPositionOffsetMs = null;
      this.#lastAcceptedSyncPositionMs = null;
      this.#syncPositionEstimate = null;
      this.#resetHighlightMemo();
    }

    if (this.#syncPositionOffsetMs !== null) {
      const normalizedPositionMs = rawPositionMs - this.#syncPositionOffsetMs;
      if (shouldUseSyncedLyricsPosition(player, normalizedPositionMs, options)) {
        return this.#acceptSyncedPosition(normalizedPositionMs);
      }
      this.#logger?.debug('sync-position-skipped', {
        positionMs: normalizedPositionMs,
        rawPositionMs,
        title: player.title,
      });
      return null;
    }

    if (shouldHoldLowConfidenceSyncedPosition(player, rawPositionMs, options)) {
      const estimate = updateStagnantSyncedPositionEstimate(this.#syncPositionEstimate, {
        canEstimate: true,
        lastAcceptedPositionMs: this.#lastAcceptedSyncPositionMs,
        nowMs: monotonicNowMs(),
        rawPositionMs,
        thresholdMs: FIREFOX_STAGNANT_POSITION_THRESHOLD_MS,
        trackKey,
      });
      this.#syncPositionEstimate = estimate.state;
      if (estimate.estimated && estimate.positionMs !== null) {
        this.#logger?.debug('sync-position-estimated', {
          positionMs: estimate.positionMs,
          rawPositionMs,
          title: player.title,
        });
        return estimate.positionMs;
      }
      this.#logger?.debug('sync-position-held-low-confidence', {
        positionMs: rawPositionMs,
        title: player.title,
      });
      return null;
    }

    if (shouldUseSyncedLyricsPosition(player, rawPositionMs, options)) {
      return this.#acceptSyncedPosition(rawPositionMs);
    }

    if (shouldUseRelativeSyncedLyricsPosition(player, rawPositionMs, options)) {
      this.#syncPositionOffsetMs = rawPositionMs;
      this.#logger?.debug('sync-position-offset-established', {
        rawPositionMs,
        title: player.title,
      });
      return this.#acceptSyncedPosition(0);
    }

    this.#logger?.debug('sync-position-skipped', {
      positionMs: rawPositionMs,
      title: player.title,
    });
    return null;
  }

  /**
   * @param {number} positionMs
   * @returns {number}
   */
  #acceptSyncedPosition(positionMs) {
    this.#lastAcceptedSyncPositionMs = positionMs;
    this.#syncPositionEstimate = null;
    return positionMs;
  }

  /**
   * @param {PlayerSnapshot} player
   * @param {Extract<LyricsProviderResult, { kind: 'synced' }>} lookup
   * @returns {string}
   */
  #buildSyncPositionTrackKey(player, lookup) {
    return [
      player.busName,
      player.title,
      player.artist,
      lookup.track.trackName,
      lookup.track.artistName,
    ].join('\u0000');
  }

  /**
   * @returns {void}
   */
  #resetSyncPositionOffset() {
    this.#syncPositionTrackKey = null;
    this.#syncPositionOffsetMs = null;
    this.#lastAcceptedSyncPositionMs = null;
    this.#syncPositionEstimate = null;
  }

  /**
   * @returns {void}
   */
  #render() {
    if (!this.#indicator || !this.#currentSettings) {
      return;
    }

    const viewModel = buildIndicatorViewModel(this.#visibleDisplayState(), this.#currentSettings);
    this.#logger?.debug('indicator-render', {
      text: viewModel.text,
      visible: viewModel.visible,
    });
    this.#indicator.render(viewModel);
  }

  /**
   * Display state after the panel-visibility policy is applied.
   *
   * The lyrics bar is a music affordance: with no player playing or paused there
   * is nothing to show, so the label is hidden rather than filled with a
   * placeholder.
   *
   * @returns {DisplayState}
   */
  #visibleDisplayState() {
    if (
      shouldHideIndicator({
        hideWhenIdle: this.#currentSettings?.hideWhenIdle === true,
        player: this.#activePlayer,
      })
    ) {
      return { kind: 'hidden' };
    }

    return this.#displayState;
  }

  /**
   * Push the latest player + lyrics state into the details popup.
   *
   * @returns {void}
   */
  #renderDetails() {
    if (!this.#indicator || typeof this.#indicator.renderDetails !== 'function') {
      return;
    }

    const player = this.#activePlayer;
    const lookup = this.#currentLookup;
    const syncedLookup = lookup !== null && lookup.kind === 'synced' ? lookup : null;
    const positionMs = this.#currentPositionMs();

    // The popup highlights by index, not by text: a repeated chorus otherwise
    // lights up every one of its occurrences and auto-scroll jumps to the first.
    const activeLineIndex =
      syncedLookup !== null && positionMs !== null
        ? selectLyricLineIndex(syncedLookup.lines, positionMs)
        : -1;

    this.#indicator.renderDetails({
      title: player?.title ?? null,
      artist: player?.artist ?? null,
      album: player?.album ?? null,
      artUrl: player?.artUrl ?? null,
      playbackStatus: player?.playbackStatus ?? 'Stopped',
      positionMs,
      durationMs: player?.durationMs ?? syncedLookup?.track.durationMs ?? null,
      trackId: player?.trackId ?? null,
      canSeek: this.#activePlayerCanSeek(),
      seekStepMs: SEEK_STEP_MS,
      lyrics: syncedLookup,
      activeLineIndex,
      lyricsSource: this.#currentSettings?.lyricsSource ?? 'musixmatch',
      resolvedProvider: syncedLookup?.source ?? null,
    });
  }

  /**
   * @returns {boolean}
   */
  #activePlayerCanSeek() {
    const player = this.#activePlayer;
    if (player === null) {
      return false;
    }
    return this.#proxies.get(player.busName)?.proxy.canSeek !== false;
  }
}

/**
 * @param {() => void} callback
 * @param {number} delayMs
 * @returns {() => void}
 */
function scheduleTimeout(callback, delayMs) {
  let sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
    sourceId = 0;
    callback();
    return GLib.SOURCE_REMOVE;
  });

  return () => {
    if (sourceId === 0) {
      return;
    }
    GLib.source_remove(sourceId);
    sourceId = 0;
  };
}

/**
 * @returns {number}
 */
function monotonicNowMs() {
  return Math.floor(GLib.get_monotonic_time() / 1000);
}
