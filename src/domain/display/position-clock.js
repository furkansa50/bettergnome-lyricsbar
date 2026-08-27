/**
 * Monotonic playback-position estimator.
 *
 * MPRIS exposes `Position` as a pull-only property, so reading it costs a D-Bus
 * round trip. Polling it fast enough for word-level highlighting (words last
 * roughly 150-400 ms) would mean tens of D-Bus calls per second from inside the
 * shell process.
 *
 * Instead the runtime anchors this clock on each position sample it accepts and
 * then interpolates locally from a monotonic timestamp. The estimate is only
 * ever used for display selection; every accepted sample re-anchors it, so drift
 * cannot accumulate across polls.
 *
 * This module is pure: callers pass the monotonic `nowMs` in, which keeps the
 * behavior testable and keeps platform clock APIs out of the domain layer.
 */

/**
 * Interpolation is abandoned when no fresh sample arrives within this window.
 *
 * A stalled sample stream means the player stopped answering, went away, or the
 * poll loop was torn down. Continuing to advance a display clock in that state
 * would show confidently wrong lyrics, so the estimate falls back to the last
 * known sample instead.
 */
export const MAX_POSITION_EXTRAPOLATION_MS = 5_000;
export const SEEK_DETECTION_THRESHOLD_MS = 1_500;

/**
 * @typedef {Readonly<{
 *   trackKey: string,
 *   positionMs: number,
 *   sampledAtMs: number,
 *   advancing: boolean,
 *   rate: number,
 *   durationMs: number | null,
 * }>} PositionClock
 *
 * @typedef {Readonly<{
 *   trackKey: string,
 *   positionMs: number,
 *   nowMs: number,
 *   advancing: boolean,
 *   rate?: number | null | undefined,
 *   durationMs?: number | null | undefined,
 * }>} PositionClockSample
 *
 * @typedef {Readonly<{
 *   maxExtrapolationMs?: number | undefined,
 * }>} PositionClockOptions
 */

/**
 * Anchor the clock on a freshly observed position.
 *
 * A different `trackKey` replaces the clock outright rather than merging, so a
 * track change can never interpolate from the previous song's position.
 *
 * When updating an active clock on the same track during continuous playback,
 * retrograde jumps caused by D-Bus roundtrip latency and player timer
 * quantization are clamped to the current monotonic estimate to prevent
 * visual flickering and word-highlight repetition. Large discrepancies
 * (outside SEEK_DETECTION_THRESHOLD_MS) are accepted immediately as seeks.
 *
 * @param {PositionClock | null} clock Previous clock.
 * @param {PositionClockSample} sample
 * @returns {PositionClock | null}
 */
export function syncPositionClock(clock, sample) {
  if (typeof sample.trackKey !== 'string' || sample.trackKey === '') {
    return null;
  }

  if (!isFiniteNonNegative(sample.positionMs) || !Number.isFinite(sample.nowMs)) {
    return null;
  }

  let { positionMs } = sample;
  if (
    clock !== null &&
    clock.trackKey === sample.trackKey &&
    clock.advancing &&
    sample.advancing === true
  ) {
    const estimatedMs = estimatePositionMs(clock, sample.nowMs, sample.trackKey);
    if (typeof estimatedMs === 'number' && Number.isFinite(estimatedMs)) {
      const delta = sample.positionMs - estimatedMs;
      if (Math.abs(delta) <= SEEK_DETECTION_THRESHOLD_MS) {
        positionMs = Math.max(sample.positionMs, estimatedMs);
      }
    }
  }

  return {
    trackKey: sample.trackKey,
    positionMs,
    sampledAtMs: sample.nowMs,
    advancing: sample.advancing === true,
    rate: normalizeRate(sample.rate),
    durationMs: normalizeDuration(sample.durationMs),
  };
}

/**
 * Estimated position for `nowMs`.
 *
 * Returns the anchored sample unchanged when the player is not advancing, when
 * the clock belongs to another track, or when the sample is too old to trust.
 *
 * @param {PositionClock | null} clock
 * @param {number} nowMs
 * @param {string | null} [trackKey] Expected track; mismatches return null.
 * @param {PositionClockOptions} [options]
 * @returns {number | null}
 */
export function estimatePositionMs(clock, nowMs, trackKey = null, options = {}) {
  if (clock === null) {
    return null;
  }

  if (typeof trackKey === 'string' && trackKey !== clock.trackKey) {
    return null;
  }

  if (!Number.isFinite(nowMs)) {
    return null;
  }

  if (!clock.advancing) {
    return clock.positionMs;
  }

  const elapsedMs = nowMs - clock.sampledAtMs;
  if (elapsedMs <= 0) {
    return clock.positionMs;
  }

  const maxExtrapolationMs = normalizeMaxExtrapolation(options.maxExtrapolationMs);
  if (elapsedMs > maxExtrapolationMs) {
    return clock.positionMs;
  }

  return clampToDuration(clock.positionMs + elapsedMs * clock.rate, clock.durationMs);
}

/**
 * Whether interpolating this clock can still produce a changing position.
 *
 * Once the anchor is older than the extrapolation window,
 * {@link estimatePositionMs} returns the anchored sample unchanged, so a caller
 * driving a display tick from it can no longer observe any movement. Callers use
 * this to stop that tick instead of spinning at full rate forever, which happens
 * whenever the poll loop keeps rejecting samples for a track.
 *
 * @param {PositionClock | null} clock
 * @param {number} nowMs
 * @param {PositionClockOptions} [options]
 * @returns {boolean}
 */
export function isPositionClockAdvancing(clock, nowMs, options = {}) {
  if (clock === null || !clock.advancing || !Number.isFinite(nowMs)) {
    return false;
  }

  const elapsedMs = nowMs - clock.sampledAtMs;
  return elapsedMs <= normalizeMaxExtrapolation(options.maxExtrapolationMs);
}

/**
 * Move the clock to a position the runtime just requested.
 *
 * Seeking is optimistic on purpose: the player's own `Position` report is up to
 * a full poll interval away, and without this the lyrics would keep showing the
 * pre-seek line until then. The next accepted sample or `Seeked` signal
 * overwrites whatever this predicted.
 *
 * @param {PositionClock | null} clock
 * @param {number} positionMs
 * @param {number} nowMs
 * @returns {PositionClock | null}
 */
export function retargetPositionClock(clock, positionMs, nowMs) {
  if (clock === null) {
    return null;
  }

  if (!isFiniteNonNegative(positionMs) || !Number.isFinite(nowMs)) {
    return clock;
  }

  return {
    ...clock,
    positionMs: clampToDuration(positionMs, clock.durationMs),
    sampledAtMs: nowMs,
  };
}

/**
 * Freeze or resume interpolation without moving the anchor.
 *
 * @param {PositionClock | null} clock
 * @param {boolean} advancing
 * @param {number} nowMs
 * @returns {PositionClock | null}
 */
export function setPositionClockAdvancing(clock, advancing, nowMs) {
  if (clock === null) {
    return null;
  }

  const shouldAdvance = advancing === true;
  if (clock.advancing === shouldAdvance) {
    return clock;
  }

  // Re-anchor on the current estimate so a pause does not retroactively discard
  // the time already elapsed since the last sample.
  const positionMs = estimatePositionMs(clock, nowMs) ?? clock.positionMs;
  return {
    ...clock,
    positionMs,
    sampledAtMs: Number.isFinite(nowMs) ? nowMs : clock.sampledAtMs,
    advancing: shouldAdvance,
  };
}

/**
 * @param {number} positionMs
 * @param {number | null} durationMs
 * @returns {number}
 */
function clampToDuration(positionMs, durationMs) {
  const floored = Math.max(0, positionMs);
  if (durationMs === null) {
    return floored;
  }
  return Math.min(floored, durationMs);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * MPRIS `Rate` is a double where 1.0 is normal speed. Non-positive or absurd
 * values are treated as normal speed rather than trusted.
 *
 * @param {number | null | undefined} value
 * @returns {number}
 */
function normalizeRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8) {
    return 1;
  }
  return value;
}

/**
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
function normalizeDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * @param {number | undefined} value
 * @returns {number}
 */
function normalizeMaxExtrapolation(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return MAX_POSITION_EXTRAPOLATION_MS;
  }
  return value;
}
