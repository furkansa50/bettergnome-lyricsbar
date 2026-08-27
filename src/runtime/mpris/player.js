import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { applyPropertyChanges, mapMprisProperties, snapshotsEqual } from './player-mapping.js';

/**
 * @import { LifecycleRegistry } from '../lifecycle.js'
 * @import { RuntimeLogger } from '../logger.js'
 * @import { PlayerSnapshot } from '../../domain/mpris/types.js'
 *
 * @typedef {(snapshot: PlayerSnapshot | null) => void} PlayerSnapshotCallback
 * @typedef {(positionMs: number | null) => void} PlayerPositionCallback
 * @typedef {(positionMs: number) => void} PlayerSeekedCallback
 */

const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PLAYER_PATH = '/org/mpris/MediaPlayer2';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

export class PlayerProxy {
  /** @type {any} */
  #connection;

  /** @type {string} */
  #busName;

  /** @type {LifecycleRegistry} */
  #lifecycle;

  /** @type {boolean} */
  #enabled = false;

  /** @type {boolean} */
  #gone = false;

  /** @type {any} */
  #cancellable = null;

  /** @type {RuntimeLogger | null} */
  #logger = null;

  /** @type {any} */
  #proxy = null;

  /** @type {number} */
  #propertiesSignalId = 0;

  /** @type {number} */
  #dbusSignalId = 0;

  /**
   * Latest `CanSeek`, or null while unknown.
   *
   * Kept off {@link PlayerSnapshot} deliberately: it is a capability, not part
   * of the displayed track identity, and adding it to the snapshot would change
   * the equality contract every stability decision is built on.
   *
   * @type {boolean | null}
   */
  #canSeek = null;

  /** @type {number} */
  #rate = 1;

  /** @type {PlayerSnapshot | null} */
  #snapshot = null;

  /** @type {Set<PlayerSnapshotCallback>} */
  #listeners = new Set();

  /** @type {Set<PlayerSeekedCallback>} */
  #seekedListeners = new Set();

  /**
   * @param {any} connection
   * @param {string} busName
   * @param {LifecycleRegistry} lifecycle
   * @param {{ logger?: RuntimeLogger | undefined }} [options]
   */
  constructor(connection, busName, lifecycle, options = {}) {
    this.#connection = connection;
    this.#busName = busName;
    this.#lifecycle = lifecycle;
    this.#logger = options.logger ?? null;
  }

  /**
   * @returns {boolean}
   */
  get enabled() {
    return this.#enabled;
  }

  /**
   * @returns {string}
   */
  get busName() {
    return this.#busName;
  }

  /**
   * Whether the player advertises seek support.
   *
   * Unknown is reported as seekable: several players never publish `CanSeek`,
   * and refusing to seek those would break a working control. Only an explicit
   * `false` disables the seek affordances.
   *
   * @returns {boolean}
   */
  get canSeek() {
    return this.#canSeek !== false;
  }

  /**
   * Latest MPRIS `Rate`, defaulting to normal speed.
   *
   * @returns {number}
   */
  get rate() {
    return this.#rate;
  }

  /**
   * @returns {PlayerSnapshot | null}
   */
  snapshot() {
    return this.#snapshot;
  }

  /**
   * @returns {void}
   */
  start() {
    if (this.#enabled) {
      return;
    }
    this.#enabled = true;
    this.#logger?.debug('proxy-start', { busName: this.#busName });

    this.#cancellable = new Gio.Cancellable();
    this.#lifecycle.addCancellable(() => this.#cancellable);
    this.#lifecycle.add(() => {
      this.#logger?.debug('proxy-dispose', { busName: this.#busName });
      this.#enabled = false;
      this.#disconnectPropertiesSignal();
      this.#proxy = null;
    });

    Gio.DBusProxy.new(
      this.#connection,
      Gio.DBusProxyFlags.NONE,
      null,
      this.#busName,
      PLAYER_PATH,
      PLAYER_IFACE,
      this.#cancellable,
      /**
       * @param {unknown} _source
       * @param {unknown} result
       * @returns {void}
       */
      (_source, result) => {
        if (!this.#enabled || this.#gone) {
          return;
        }
        try {
          this.#proxy = Gio.DBusProxy.new_finish(result);
          this.#logger?.debug('proxy-ready', { busName: this.#busName });
          this.#bindProxy(this.#proxy);
        } catch (error) {
          if (!isCancelledError(error)) {
            this.#emitGone();
            console.error(`LyricBar: failed to create MPRIS proxy for ${this.#busName}`, error);
          }
        }
      },
    );
  }

  /**
   * @param {PlayerSnapshotCallback} callback
   * @returns {void}
   */
  onSnapshot(callback) {
    this.#listeners.add(callback);
    this.#lifecycle.add(() => {
      this.#listeners.delete(callback);
    });
    callback(this.#snapshot);
  }

  /**
   * @param {PlayerPositionCallback} callback
   * @returns {void}
   */
  readPosition(callback) {
    if (!this.#enabled || this.#gone || this.#cancellable === null) {
      callback(null);
      return;
    }

    this.#connection.call(
      this.#busName,
      PLAYER_PATH,
      PROPERTIES_IFACE,
      'Get',
      new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
      new GLib.VariantType('(v)'),
      Gio.DBusCallFlags.NONE,
      -1,
      this.#cancellable,
      /**
       * @param {unknown} _source
       * @param {unknown} result
       * @returns {void}
       */
      (_source, result) => {
        if (!this.#enabled || this.#gone) {
          callback(null);
          return;
        }
        try {
          const reply = this.#connection.call_finish(result);
          callback(readPositionReply(reply));
        } catch (error) {
          if (!isCancelledError(error)) {
            this.#logger?.debug('position-read-failed', { busName: this.#busName });
          }
          callback(null);
        }
      },
    );
  }

  /**
   * @returns {void}
   */
  refreshProperties() {
    this.#refreshAllProperties();
  }

  /**
   * Toggle playback (play/pause) on the active player via MPRIS.
   *
   * @returns {void}
   */
  playPause() {
    this.#callPlayerMethod('PlayPause');
  }

  /**
   * Skip to the next track.
   *
   * @returns {void}
   */
  next() {
    this.#callPlayerMethod('Next');
  }

  /**
   * Skip to the previous track.
   *
   * @returns {void}
   */
  previous() {
    this.#callPlayerMethod('Previous');
  }

  /**
   * Seek to an absolute position. Requires the MPRIS trackId so the player can
   * reject the seek if the track has changed underneath us.
   *
   * @param {string | null} trackId MPRIS `mpris:trackid`, or null to skip.
   * @param {number} positionMs Absolute position in milliseconds.
   * @returns {void}
   */
  setPosition(trackId, positionMs) {
    if (typeof trackId !== 'string' || trackId === '') {
      return;
    }
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
      return;
    }

    // The tuple children are raw values, not Variants: wrapping trackId in its
    // own GLib.Variant here would throw when the '(ox)' tuple is built.
    const positionUs = Math.round(positionMs * 1000);
    this.#callPlayerMethodWithArgs('SetPosition', new GLib.Variant('(ox)', [trackId, positionUs]));
  }

  /**
   * Seek relative to the current position.
   *
   * This is the MPRIS call that rewind and fast-forward should use. Unlike
   * `SetPosition` it needs no track id, and players that only implement one of
   * the two seek methods almost always implement this one. Negative offsets
   * rewind; MPRIS requires the player to clamp at the track boundaries.
   *
   * @param {number} offsetMs Signed offset in milliseconds.
   * @returns {void}
   */
  seek(offsetMs) {
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs) || offsetMs === 0) {
      return;
    }

    const offsetUs = Math.round(offsetMs * 1000);
    this.#callPlayerMethodWithArgs('Seek', new GLib.Variant('(x)', [offsetUs]));
  }

  /**
   * Subscribe to the MPRIS `Seeked` signal.
   *
   * Players emit this after any jump, including ones triggered from their own
   * UI or from a media key. Without it the lyric line stays on the pre-seek
   * position until the next poll.
   *
   * @param {PlayerSeekedCallback} callback
   * @returns {void}
   */
  onSeeked(callback) {
    this.#seekedListeners.add(callback);
    this.#lifecycle.add(() => {
      this.#seekedListeners.delete(callback);
    });
  }

  /**
   * Invoke a parameter-less MPRIS Player method (PlayPause, Next, Previous).
   *
   * These are fire-and-forget: errors (e.g. player missing the method) are
   * logged and swallowed so a popup button click never crashes the shell.
   *
   * @param {string} method
   * @returns {void}
   */
  #callPlayerMethod(method) {
    this.#callPlayerMethodWithArgs(method, null);
  }

  /**
   * @param {string} method
   * @param {any} parameters GLib.Variant of the method parameters, or null.
   * @returns {void}
   */
  #callPlayerMethodWithArgs(method, parameters) {
    if (!this.#enabled || this.#gone || this.#connection === null) {
      return;
    }

    this.#logger?.debug('player-call', { busName: this.#busName, method });

    try {
      this.#connection.call(
        this.#busName,
        PLAYER_PATH,
        PLAYER_IFACE,
        method,
        parameters,
        // Every MPRIS Player method used here replies with an empty tuple.
        new GLib.VariantType('()'),
        Gio.DBusCallFlags.NONE,
        -1,
        this.#cancellable,
        /**
         * @param {unknown} _source
         * @param {unknown} result
         * @returns {void}
         */
        (_source, result) => {
          if (!this.#enabled || this.#gone) {
            return;
          }
          try {
            this.#connection.call_finish(result);
          } catch (error) {
            if (!isCancelledError(error)) {
              this.#logger?.debug('player-call-failed', {
                busName: this.#busName,
                method,
              });
            }
          }
        },
      );
    } catch {
      this.#logger?.debug('player-call-threw', { busName: this.#busName, method });
    }
  }

  /**
   * @param {any} proxy
   * @returns {void}
   */
  #bindProxy(proxy) {
    const initial = readCachedProperties(proxy);
    this.#applyCapabilities(initial);
    const snapshot = mapMprisProperties(this.#busName, initial);
    this.#updateSnapshot(snapshot);
    this.#refreshAllProperties();

    this.#propertiesSignalId = proxy.connect(
      'g-properties-changed',
      /**
       * @param {unknown} _proxy
       * @param {unknown} changedProperties
       * @returns {void}
       */
      (_proxy, changedProperties) => {
        if (!this.#enabled || this.#gone) {
          return;
        }
        const changes = unpackChangedProperties(changedProperties);
        if (changes === null) {
          return;
        }
        this.#applyCapabilities(changes);
        this.#applyChanges(changes);
      },
    );

    this.#dbusSignalId = proxy.connect(
      'g-signal',
      /**
       * @param {unknown} _proxy
       * @param {unknown} _senderName
       * @param {unknown} signalName
       * @param {unknown} parameters
       * @returns {void}
       */
      (_proxy, _senderName, signalName, parameters) => {
        if (!this.#enabled || this.#gone || signalName !== 'Seeked') {
          return;
        }
        const positionMs = readSeekedPosition(parameters);
        if (positionMs === null) {
          return;
        }
        this.#logger?.debug('player-seeked', { busName: this.#busName, positionMs });
        for (const listener of [...this.#seekedListeners]) {
          listener(positionMs);
        }
      },
    );
  }

  /**
   * Track the capability properties that never belong to the track snapshot.
   *
   * @param {{ [key: string]: unknown }} properties
   * @returns {void}
   */
  #applyCapabilities(properties) {
    if (Object.hasOwn(properties, 'CanSeek')) {
      const value = unpackVariantValue(Reflect.get(properties, 'CanSeek'));
      if (typeof value === 'boolean') {
        this.#canSeek = value;
      }
    }

    if (Object.hasOwn(properties, 'Rate')) {
      const value = unpackVariantValue(Reflect.get(properties, 'Rate'));
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        this.#rate = value;
      }
    }
  }

  /**
   * @param {{ [key: string]: unknown }} changes
   * @returns {void}
   */
  #applyChanges(changes) {
    if (this.#snapshot === null) {
      const next = mapMprisProperties(this.#busName, changes);
      this.#updateSnapshot(next);
      return;
    }

    const next = applyPropertyChanges(this.#snapshot, changes);
    this.#updateSnapshot(next);
  }

  /**
   * @returns {void}
   */
  #refreshAllProperties() {
    if (this.#cancellable === null) {
      return;
    }

    this.#connection.call(
      this.#busName,
      PLAYER_PATH,
      PROPERTIES_IFACE,
      'GetAll',
      new GLib.Variant('(s)', [PLAYER_IFACE]),
      new GLib.VariantType('(a{sv})'),
      Gio.DBusCallFlags.NONE,
      -1,
      this.#cancellable,
      /**
       * @param {unknown} _source
       * @param {unknown} result
       * @returns {void}
       */
      (_source, result) => {
        if (!this.#enabled || this.#gone) {
          return;
        }
        let properties;
        try {
          const reply = this.#connection.call_finish(result);
          properties = unpackGetAllReply(reply);
        } catch (error) {
          if (!isCancelledError(error)) {
            this.#logger?.debug('properties-get-all-failed', { busName: this.#busName });
          }
          return;
        }
        if (properties === null) {
          return;
        }
        this.#applyCapabilities(properties);
        const next = mapMprisProperties(this.#busName, properties);
        this.#updateSnapshot(next);
      },
    );
  }

  /**
   * @param {PlayerSnapshot | null} next
   * @returns {void}
   */
  #updateSnapshot(next) {
    if (snapshotsEqual(this.#snapshot, next)) {
      return;
    }
    this.#snapshot = next;
    this.#logger?.debug('snapshot-changed', {
      busName: this.#busName,
      playbackStatus: next?.playbackStatus ?? null,
      title: next?.title ?? null,
    });
    for (const listener of this.#listeners) {
      listener(next);
    }
  }

  /**
   * @returns {void}
   */
  #emitGone() {
    if (this.#gone) {
      return;
    }
    this.#gone = true;
    this.#disconnectPropertiesSignal();
    this.#updateSnapshot(null);
  }

  /**
   * @returns {void}
   */
  #disconnectPropertiesSignal() {
    for (const signalId of [this.#propertiesSignalId, this.#dbusSignalId]) {
      if (!this.#proxy || signalId === 0) {
        continue;
      }
      try {
        if (isSignalHandlerConnected(this.#proxy, signalId)) {
          this.#proxy.disconnect(signalId);
        }
      } catch {
        // proxy already gone, nothing to clean up
      }
    }
    this.#propertiesSignalId = 0;
    this.#dbusSignalId = 0;
  }
}

/**
 * @param {any} target
 * @param {number} signalId
 * @returns {boolean}
 */
function isSignalHandlerConnected(target, signalId) {
  const checker = Reflect.get(GObject, 'signal_handler_is_connected');
  if (typeof checker !== 'function') {
    return true;
  }
  return checker(target, signalId) === true;
}

/**
 * @param {any} proxy
 * @returns {{ [key: string]: unknown }}
 */
function readCachedProperties(proxy) {
  /** @type {{ [key: string]: unknown }} */
  const result = {};
  if (!proxy || typeof proxy.get_cached_property_names !== 'function') {
    return result;
  }

  const names = proxy.get_cached_property_names();
  if (!Array.isArray(names)) {
    return result;
  }

  for (const name of names) {
    if (typeof name !== 'string') {
      continue;
    }
    const value = proxy.get_cached_property?.(name);
    if (value === null || value === undefined) {
      continue;
    }
    result[name] = typeof value.deep_unpack === 'function' ? value.deep_unpack() : value;
  }
  return result;
}

/**
 * @param {unknown} variant
 * @returns {{ [key: string]: unknown } | null}
 */
function unpackChangedProperties(variant) {
  if (variant === null || variant === undefined) {
    return null;
  }
  const candidate = /** @type {{ deep_unpack?: unknown }} */ (variant);
  if (typeof candidate.deep_unpack !== 'function') {
    return null;
  }
  const unpacked = /** @type {{ deep_unpack: () => unknown }} */ (candidate).deep_unpack();
  if (unpacked === null || typeof unpacked !== 'object') {
    return null;
  }
  return /** @type {{ [key: string]: unknown }} */ (unpacked);
}

/**
 * @param {unknown} variant
 * @returns {{ [key: string]: unknown } | null}
 */
function unpackGetAllReply(variant) {
  if (variant === null || variant === undefined) {
    return null;
  }
  const candidate = /** @type {{ deep_unpack?: unknown }} */ (variant);
  if (typeof candidate.deep_unpack !== 'function') {
    return null;
  }
  const unpacked = /** @type {{ deep_unpack: () => unknown }} */ (candidate).deep_unpack();
  if (!Array.isArray(unpacked) || unpacked.length < 1) {
    return null;
  }
  const properties = unpacked[0];
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return null;
  }
  return /** @type {{ [key: string]: unknown }} */ (properties);
}

/**
 * @param {unknown} variant
 * @returns {number | null}
 */
function readPositionReply(variant) {
  const unpacked = unpackVariantValue(variant);
  if (!Array.isArray(unpacked) || unpacked.length < 1) {
    return null;
  }

  const positionUs = unpackVariantValue(unpacked[0]);
  if (typeof positionUs !== 'number' || !Number.isFinite(positionUs) || positionUs < 0) {
    return null;
  }

  return Math.round(positionUs / 1000);
}

/**
 * Read the microsecond position carried by an MPRIS `Seeked` signal.
 *
 * @param {unknown} parameters `(x)` tuple emitted with the signal.
 * @returns {number | null}
 */
function readSeekedPosition(parameters) {
  const unpacked = unpackVariantValue(parameters);
  const positionUs = Array.isArray(unpacked) ? unpackVariantValue(unpacked[0]) : unpacked;
  if (typeof positionUs !== 'number' || !Number.isFinite(positionUs) || positionUs < 0) {
    return null;
  }

  return Math.round(positionUs / 1000);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function unpackVariantValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const candidate = /** @type {{ deep_unpack?: unknown }} */ (value);
  if (typeof candidate.deep_unpack === 'function') {
    return unpackVariantValue(
      /** @type {{ deep_unpack: () => unknown }} */ (candidate).deep_unpack(),
    );
  }

  return value;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isCancelledError(error) {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const candidate = /** @type {{ matches?: unknown }} */ (error);
  if (typeof candidate.matches !== 'function') {
    return false;
  }
  try {
    return (
      /** @type {{ matches: (domain: unknown, code: unknown) => boolean }} */ (candidate).matches(
        Gio.IOErrorEnum,
        Gio.IOErrorEnum.CANCELLED,
      ) === true
    );
  } catch {
    return false;
  }
}
