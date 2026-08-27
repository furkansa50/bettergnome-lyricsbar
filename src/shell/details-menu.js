import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
  computeBarFraction,
  computeProgressFraction,
  computeScrollValue,
  computeSeekPositionMs,
  formatTrackTime,
} from '../domain/display/track-progress.js';
import { _t } from '../runtime/i18n.js';

/**
 * @import { LyricsProviderResult } from '../domain/lyrics/types.js'
 *
 * @typedef {Extract<LyricsProviderResult, { kind: 'synced' }>} SyncedLyrics
 *
 * @typedef {Readonly<{
 *   title: string | null,
 *   artist: string | null,
 *   album: string | null,
 *   artUrl: string | null,
 *   playbackStatus: import('../domain/mpris/types.js').PlaybackStatus,
 *   positionMs: number | null,
 *   durationMs: number | null,
 *   trackId: string | null,
 *   canSeek?: boolean,
 *   seekStepMs?: number,
 *   lyrics: SyncedLyrics | null,
 *   activeLineIndex: number,
 * }>} DetailsMenuState
 *
 * @typedef {Readonly<{
 *   onPlayPause: () => void,
 *   onNext: () => void,
 *   onPrevious: () => void,
 *   onSeek: (positionMs: number) => void,
 *   onSeekBy: (offsetMs: number) => void,
 * }>} DetailsMenuActions
 */

const FALLBACK_ICON_NAME = 'audio-x-generic-symbolic';
const ALBUM_ART_SIZE = 120;
const LYRICS_SCROLL_HEIGHT = 200;

/** Fallback rewind / fast-forward step when the controller does not supply one. */
const DEFAULT_SEEK_STEP_MS = 10_000;

/** Fallback row height used before the lyric labels have been allocated. */
const ESTIMATED_LINE_HEIGHT = 20;

/**
 * Build the details menu section for the LyricBar indicator popup.
 *
 * Returns a PopupMenu.PopupMenuSection that can be added to
 * `PanelMenu.Button.menu`. Call `update(state)` whenever the
 * player state changes.
 *
 * All St actors created here are owned by the returned object;
 * call `destroy()` during extension disable.
 *
 * @param {any} menu Owning PopupMenu, used to re-sync layout on open.
 * @param {DetailsMenuActions} actions
 */
export function buildDetailsMenu(menu, actions) {
  const section = new PopupMenu.PopupMenuSection();

  // --- Album Art + Title / Artist ---
  const headerBox = new St.BoxLayout({ style_class: 'lyricbar-details-header' });
  setOrientation(headerBox, false);

  const artIcon = new St.Icon({
    icon_name: FALLBACK_ICON_NAME,
    icon_size: ALBUM_ART_SIZE,
    style_class: 'lyricbar-details-art-icon',
  });
  const artBin = new St.Bin({
    style_class: 'lyricbar-details-art',
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    child: artIcon,
  });

  const infoBox = new St.BoxLayout({ style_class: 'lyricbar-details-info' });
  setOrientation(infoBox, true);

  const titleLabel = new St.Label({
    style_class: 'lyricbar-details-title',
    text: '',
  });
  const artistLabel = new St.Label({
    style_class: 'lyricbar-details-artist',
    text: '',
  });

  infoBox.add_child(titleLabel);
  infoBox.add_child(artistLabel);
  headerBox.add_child(artBin);
  headerBox.add_child(infoBox);

  const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
  headerItem.add_child(headerBox);
  section.addMenuItem(headerItem);

  // --- Progress Bar ---
  const progressBox = new St.BoxLayout({ style_class: 'lyricbar-details-progress' });

  const positionLabel = new St.Label({
    style_class: 'lyricbar-details-position',
    text: '0:00',
  });

  // A BoxLayout, not a bare St.Widget: the fill child must be allocated the
  // full bar height, and only a layout manager does that.
  const progressBar = new St.BoxLayout({
    style_class: 'lyricbar-details-progress-bar',
    reactive: true,
    x_expand: true,
  });
  const progressFill = new St.Widget({
    style_class: 'lyricbar-details-progress-fill',
    y_expand: true,
    width: 0,
  });
  progressBar.add_child(progressFill);

  const durationLabel = new St.Label({
    style_class: 'lyricbar-details-duration',
    text: '0:00',
  });

  progressBox.add_child(positionLabel);
  progressBox.add_child(progressBar);
  progressBox.add_child(durationLabel);

  const progressItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
  progressItem.add_child(progressBox);
  section.addMenuItem(progressItem);

  // --- Playback Controls ---
  const controlsBox = new St.BoxLayout({ style_class: 'lyricbar-details-controls' });

  const prevButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 20 }),
    accessible_name: _t('Previous', 'Önceki'),
  });
  // Rewind and fast-forward are distinct from previous/next: they seek inside the
  // current track through relative MPRIS Seek rather than changing tracks.
  const rewindButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-seek-backward-symbolic', icon_size: 20 }),
    accessible_name: _t('Rewind', 'Geri sar'),
  });
  const playPauseButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 24 }),
    accessible_name: _t('Play', 'Oynat'),
  });
  const forwardButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-seek-forward-symbolic', icon_size: 20 }),
    accessible_name: _t('Fast forward', 'İleri sar'),
  });
  const nextButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 20 }),
    accessible_name: _t('Next', 'Sonraki'),
  });

  controlsBox.add_child(prevButton);
  controlsBox.add_child(rewindButton);
  controlsBox.add_child(playPauseButton);
  controlsBox.add_child(forwardButton);
  controlsBox.add_child(nextButton);

  const controlsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
  controlsItem.add_child(controlsBox);
  section.addMenuItem(controlsItem);

  // --- Separator ---
  section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

  // --- Lyrics Scroll View ---
  const scrollView = new St.ScrollView({
    style_class: 'lyricbar-details-lyrics-scroll',
    hscrollbar_policy: St.PolicyType.NEVER,
    vscrollbar_policy: St.PolicyType.AUTOMATIC,
    style: `max-height: ${LYRICS_SCROLL_HEIGHT}px;`,
  });

  const lyricsBox = new St.BoxLayout({ style_class: 'lyricbar-details-lyrics' });
  setOrientation(lyricsBox, true);
  setScrollChild(scrollView, lyricsBox);

  const lyricsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
  lyricsItem.add_child(scrollView);
  section.addMenuItem(lyricsItem);

  // --- Internal state ---
  /** @type {string | null} */
  let currentArtUrl = null;

  /**
   * Last rendered lyrics object. Compared by identity: the controller reuses the
   * same frozen lookup for every tick of a track, so identity is enough to know
   * when the label list must be rebuilt.
   *
   * @type {SyncedLyrics | null}
   */
  let currentLyrics = null;

  /** @type {any[]} */
  let lineLabels = [];

  /** Index currently carrying the active style class, or -1. */
  let activeLabelIndex = -1;

  /** Latest progress fraction, replayed whenever the bar is re-allocated. */
  let progressFraction = 0;

  /**
   * Latest known duration, needed to turn a click position into a seek.
   *
   * @type {number | null}
   */
  let seekDurationMs = null;

  /** Whether the active player advertises seek support. */
  let seekEnabled = true;

  /** Step applied by the rewind and fast-forward buttons. */
  let seekStepMs = DEFAULT_SEEK_STEP_MS;

  const prevClickedId = prevButton.connect('clicked', () => actions.onPrevious());
  const playPauseClickedId = playPauseButton.connect('clicked', () => actions.onPlayPause());
  const nextClickedId = nextButton.connect('clicked', () => actions.onNext());
  const rewindClickedId = rewindButton.connect('clicked', () => actions.onSeekBy(-seekStepMs));
  const forwardClickedId = forwardButton.connect('clicked', () => actions.onSeekBy(seekStepMs));

  // St CSS has no percentage units, so the fill width is recomputed in pixels
  // from the bar's allocation every time that allocation changes.
  const progressWidthId = progressBar.connect('notify::width', () => {
    applyProgressFill(progressBar, progressFill, progressFraction);
  });

  const progressPressId = progressBar.connect(
    'button-press-event',
    /**
     * @param {any} actor
     * @param {any} event
     * @returns {unknown}
     */
    (actor, event) => {
      if (!seekEnabled) {
        return Clutter.EVENT_PROPAGATE;
      }

      const fraction = readPressFraction(actor, event);
      if (fraction === null) {
        return Clutter.EVENT_PROPAGATE;
      }

      const positionMs = computeSeekPositionMs(fraction, seekDurationMs);
      if (positionMs === null) {
        return Clutter.EVENT_PROPAGATE;
      }

      // Move the fill immediately: the player's next Position report is up to a
      // full poll interval away and the bar would otherwise snap back.
      progressFraction = fraction;
      applyProgressFill(progressBar, progressFill, progressFraction);
      actions.onSeek(positionMs);
      return Clutter.EVENT_STOP;
    },
  );

  // While the popup is closed its actors have no allocation, so the fill width
  // and the scroll offset cannot be computed. Re-apply both on open.
  const menuStateId =
    typeof menu?.connect === 'function'
      ? menu.connect(
          'open-state-changed',
          (/** @type {unknown} */ _menu, /** @type {boolean} */ open) => {
            if (open !== true) {
              return;
            }
            applyProgressFill(progressBar, progressFill, progressFraction);
            scrollToLine(lyricsBox, scrollView, activeLabelIndex);
          },
        )
      : 0;

  // The first allocation after an open, and every lyrics rebuild, changes the
  // box height. Re-centre then, otherwise the popup opens scrolled to the top
  // of a song that is already half-way through.
  const lyricsHeightId = lyricsBox.connect('notify::height', () => {
    scrollToLine(lyricsBox, scrollView, activeLabelIndex);
  });

  return {
    section,

    /**
     * Update the details menu contents.
     *
     * Called on every position poll, so everything here is either an identity
     * check or a single property write; the lyric labels are only rebuilt when
     * the track's lyrics actually change.
     *
     * @param {DetailsMenuState} state
     */
    update(state) {
      setLabelText(titleLabel, state.title ?? '');
      setLabelText(artistLabel, state.artist ?? '');

      if (state.artUrl !== currentArtUrl) {
        currentArtUrl = state.artUrl;
        applyAlbumArt(artIcon, state.artUrl);
      }

      const isPlaying = state.playbackStatus === 'Playing';
      const playPauseIcon = playPauseButton.child;
      if (playPauseIcon) {
        setIconName(
          playPauseIcon,
          isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
        );
      }

      setLabelText(positionLabel, formatTrackTime(state.positionMs));
      setLabelText(durationLabel, formatTrackTime(state.durationMs));

      seekDurationMs = state.durationMs;
      seekEnabled = state.canSeek !== false;
      seekStepMs =
        typeof state.seekStepMs === 'number' &&
        Number.isFinite(state.seekStepMs) &&
        state.seekStepMs > 0
          ? state.seekStepMs
          : DEFAULT_SEEK_STEP_MS;

      // A player that cannot seek keeps its buttons visible but inert, so the
      // popup layout does not reflow when a track changes seekability.
      setReactive(rewindButton, seekEnabled);
      setReactive(forwardButton, seekEnabled);

      progressFraction = computeProgressFraction(state.positionMs, state.durationMs);
      applyProgressFill(progressBar, progressFill, progressFraction);

      if (state.lyrics !== currentLyrics) {
        currentLyrics = state.lyrics;
        lineLabels = rebuildLyricLabels(lyricsBox, state.lyrics);
        activeLabelIndex = -1;
      }

      const nextActive = normalizeActiveIndex(state.activeLineIndex, lineLabels.length);
      if (nextActive !== activeLabelIndex) {
        setActiveLine(lineLabels, activeLabelIndex, nextActive);
        activeLabelIndex = nextActive;
        scrollToLine(lyricsBox, scrollView, activeLabelIndex);
      }
    },

    destroy() {
      disconnectSafely(prevButton, prevClickedId);
      disconnectSafely(playPauseButton, playPauseClickedId);
      disconnectSafely(nextButton, nextClickedId);
      disconnectSafely(rewindButton, rewindClickedId);
      disconnectSafely(forwardButton, forwardClickedId);
      disconnectSafely(progressBar, progressWidthId);
      disconnectSafely(progressBar, progressPressId);
      disconnectSafely(lyricsBox, lyricsHeightId);
      disconnectSafely(menu, menuStateId);

      lineLabels = [];
      activeLabelIndex = -1;
      currentLyrics = null;
      currentArtUrl = null;
      seekDurationMs = null;

      // The section owns every actor built above, so destroying it tears down
      // the whole subtree in one step.
      try {
        section.destroy();
      } catch {
        // already destroyed with the owning menu
      }
    },
  };
}

/**
 * Point an existing St.Icon at the current album art.
 *
 * The icon actor is reused rather than replaced so a track change does not leave
 * an orphaned actor behind on every poll.
 *
 * @param {any} icon
 * @param {string | null} artUrl
 * @returns {void}
 */
function applyAlbumArt(icon, artUrl) {
  const gicon = resolveArtGicon(artUrl);

  try {
    Reflect.set(icon, 'gicon', gicon);
  } catch {
    // gicon rejected by St; fall through to the themed fallback below
  }

  if (gicon === null) {
    setIconName(icon, FALLBACK_ICON_NAME);
  }
}

/**
 * Build a GIcon for an `mpris:artUrl` value.
 *
 * Players publish either a URI (`https://` for Spotify and browsers, `file://`
 * for local libraries) or, less often, a bare absolute path. Anything else --
 * including the `data:` URIs some browsers emit, which GIO cannot open -- is
 * rejected so the caller can show the fallback icon instead of a blank box.
 *
 * @param {string | null} artUrl
 * @returns {unknown}
 */
function resolveArtGicon(artUrl) {
  if (typeof artUrl !== 'string') {
    return null;
  }

  const trimmed = artUrl.trim();
  if (trimmed === '') {
    return null;
  }

  const isUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (!isUri && !trimmed.startsWith('/')) {
    return null;
  }

  try {
    const file = isUri ? Gio.File.new_for_uri(trimmed) : Gio.File.new_for_path(trimmed);
    return new Gio.FileIcon({ file });
  } catch {
    return null;
  }
}

/**
 * Replace the lyric labels with one per line, returning them in order.
 *
 * @param {any} lyricsBox
 * @param {SyncedLyrics | null} lyrics
 * @returns {any[]}
 */
function rebuildLyricLabels(lyricsBox, lyrics) {
  destroyChildren(lyricsBox);

  const lines = lyrics?.lines ?? [];
  if (lines.length === 0) {
    lyricsBox.add_child(
      new St.Label({
        style_class: 'lyricbar-details-no-lyrics',
        text: _t('No lyrics available', 'Söz bulunamadı'),
      }),
    );
    return [];
  }

  /** @type {any[]} */
  const labels = [];
  for (const line of lines) {
    const label = new St.Label({
      style_class: 'lyricbar-details-lyric-line',
      text: line.text,
    });
    lyricsBox.add_child(label);
    labels.push(label);
  }
  return labels;
}

/**
 * Move the active style class from one lyric label to another.
 *
 * Highlighting by index rather than by text is what keeps a repeated chorus from
 * lighting up every one of its occurrences at once.
 *
 * @param {readonly any[]} labels
 * @param {number} previousIndex
 * @param {number} nextIndex
 * @returns {void}
 */
function setActiveLine(labels, previousIndex, nextIndex) {
  const previousLabel = previousIndex >= 0 ? labels[previousIndex] : undefined;
  if (previousLabel) {
    removeStyleClass(previousLabel, 'lyricbar-details-lyric-active');
  }

  const nextLabel = nextIndex >= 0 ? labels[nextIndex] : undefined;
  if (nextLabel) {
    addStyleClass(nextLabel, 'lyricbar-details-lyric-active');
  }
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
function normalizeActiveIndex(index, length) {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= length) {
    return -1;
  }
  return index;
}

/**
 * Scroll the lyrics view so the active line sits in the middle of the page.
 *
 * @param {any} lyricsBox
 * @param {any} scrollView
 * @param {number} activeIndex
 * @returns {void}
 */
function scrollToLine(lyricsBox, scrollView, activeIndex) {
  if (activeIndex < 0) {
    return;
  }

  const children = lyricsBox.get_children?.();
  if (!Array.isArray(children)) {
    return;
  }

  const activeChild = children[activeIndex];
  if (!activeChild) {
    return;
  }

  try {
    const adjustment = readVerticalAdjustment(scrollView);
    if (adjustment === null) {
      return;
    }

    const value = computeScrollValue({
      childY: readNumber(activeChild, 'get_y', 'y', 0),
      childHeight: readNumber(activeChild, 'get_height', 'height', ESTIMATED_LINE_HEIGHT),
      pageSize: readNumber(adjustment, 'get_page_size', 'page_size', 0),
      upper: readNumber(adjustment, 'get_upper', 'upper', 0),
    });

    if (value !== null) {
      adjustment.set_value(value);
    }
  } catch {
    // scroll adjustment not available yet; non-critical
  }
}

/**
 * GNOME 46 dropped `St.ScrollView.get_vscroll_bar()`; the adjustment is exposed
 * directly. Both spellings are probed so the extension keeps working on 45.
 *
 * @param {any} scrollView
 * @returns {any}
 */
function readVerticalAdjustment(scrollView) {
  const direct = Reflect.get(scrollView, 'vadjustment');
  if (direct !== null && direct !== undefined) {
    return direct;
  }

  const legacy = scrollView.get_vscroll_bar?.()?.get_adjustment?.();
  return legacy ?? null;
}

/**
 * Fraction of the progress bar a pointer press landed on.
 *
 * @param {any} actor
 * @param {any} event
 * @returns {number | null}
 */
function readPressFraction(actor, event) {
  const localX = readLocalPressX(actor, event);
  if (localX === null) {
    return null;
  }

  return computeBarFraction(localX, readNumber(actor, 'get_width', 'width', 0));
}

/**
 * @param {any} actor
 * @param {any} event
 * @returns {number | null}
 */
function readLocalPressX(actor, event) {
  const coords = typeof event?.get_coords === 'function' ? event.get_coords() : null;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const stageX = Number(coords[0]);
  const stageY = Number(coords[1]);
  if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) {
    return null;
  }

  if (typeof actor.transform_stage_point === 'function') {
    // GJS returns the C out-parameters as [ok, x, y].
    const transformed = actor.transform_stage_point(stageX, stageY);
    if (Array.isArray(transformed) && transformed[0] === true && Number.isFinite(transformed[1])) {
      return Number(transformed[1]);
    }
  }

  if (typeof actor.get_transformed_position === 'function') {
    const position = actor.get_transformed_position();
    if (Array.isArray(position) && Number.isFinite(Number(position[0]))) {
      return stageX - Number(position[0]);
    }
  }

  return null;
}

/**
 * Size the fill to `fraction` of the bar's allocated width.
 *
 * No-op while the bar is unallocated; `notify::width` replays it once the popup
 * is laid out.
 *
 * @param {any} bar
 * @param {any} fill
 * @param {number} fraction
 * @returns {void}
 */
function applyProgressFill(bar, fill, fraction) {
  const barWidth = readNumber(bar, 'get_width', 'width', 0);
  if (!Number.isFinite(barWidth) || barWidth <= 0) {
    return;
  }

  const width = Math.round(Math.min(1, Math.max(0, fraction)) * barWidth);
  try {
    fill.set_width(width);
  } catch {
    Reflect.set(fill, 'width', width);
  }
}

/**
 * GNOME 48 deprecates `set_vertical()` in favour of the `orientation` property.
 * Prefer the property and fall back for older shells.
 *
 * @param {any} box
 * @param {boolean} vertical
 * @returns {void}
 */
function setOrientation(box, vertical) {
  const orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
  if (orientation !== undefined) {
    try {
      Reflect.set(box, 'orientation', orientation);
      return;
    } catch {
      // property missing on this shell version; fall through
    }
  }

  box.set_vertical?.(vertical);
}

/**
 * GNOME 46 replaced `St.ScrollView.add_child()` with `set_child()`; calling the
 * old name there adds the box as a sibling of the viewport and nothing renders.
 *
 * @param {any} scrollView
 * @param {any} child
 * @returns {void}
 */
function setScrollChild(scrollView, child) {
  if (typeof scrollView.set_child === 'function') {
    scrollView.set_child(child);
    return;
  }
  scrollView.add_child?.(child);
}

/**
 * Read a numeric actor property, preferring its getter.
 *
 * @param {any} target
 * @param {string} getter
 * @param {string} property
 * @param {number} fallback
 * @returns {number}
 */
function readNumber(target, getter, property, fallback) {
  const fn = Reflect.get(target, getter);
  if (typeof fn === 'function') {
    const value = Number(fn.call(target));
    if (Number.isFinite(value)) {
      return value;
    }
  }

  const value = Number(Reflect.get(target, property));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Safely destroy all children of an actor.
 *
 * @param {any} actor
 * @returns {void}
 */
function destroyChildren(actor) {
  if (!actor) {
    return;
  }
  try {
    if (typeof actor.destroy_all_children === 'function') {
      actor.destroy_all_children();
      return;
    }
    const children = actor.get_children?.();
    if (Array.isArray(children)) {
      for (const child of children) {
        child?.destroy?.();
      }
    }
  } catch {
    // ignore non-critical layout errors
  }
}

/**
 * @param {any} target
 * @param {number} handlerId
 * @returns {void}
 */
function disconnectSafely(target, handlerId) {
  if (!target || !handlerId) {
    return;
  }
  try {
    target.disconnect(handlerId);
  } catch {
    // already gone
  }
}

/**
 * @param {any} actor
 * @param {string} name
 * @returns {void}
 */
function addStyleClass(actor, name) {
  try {
    actor.add_style_class_name(name);
  } catch {
    // actor destroyed
  }
}

/**
 * @param {any} actor
 * @param {string} name
 * @returns {void}
 */
function removeStyleClass(actor, name) {
  try {
    actor.remove_style_class_name(name);
  } catch {
    // actor destroyed
  }
}

/**
 * @param {any} label
 * @param {string} text
 * @returns {void}
 */
function setLabelText(label, text) {
  try {
    label.set_text(text);
  } catch {
    Reflect.set(label, 'text', text);
  }
}

/**
 * @param {any} icon
 * @param {string} name
 * @returns {void}
 */
function setIconName(icon, name) {
  try {
    icon.set_icon_name(name);
  } catch {
    Reflect.set(icon, 'icon_name', name);
  }
}

/**
 * Enable or disable a control without removing it from the layout.
 *
 * The dimmed style class is applied alongside reactivity so an inert button is
 * visibly inert rather than silently ignoring clicks.
 *
 * @param {any} button
 * @param {boolean} enabled
 * @returns {void}
 */
function setReactive(button, enabled) {
  try {
    button.reactive = enabled;
  } catch {
    Reflect.set(button, 'reactive', enabled);
  }

  if (enabled) {
    removeStyleClass(button, 'lyricbar-details-button-insensitive');
    return;
  }
  addStyleClass(button, 'lyricbar-details-button-insensitive');
}
