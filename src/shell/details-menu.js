import Gio from 'gi://Gio';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _t } from '../runtime/i18n.js';

/**
 * @import { LyricsProviderResult } from '../domain/lyrics/types.js'
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
 *   lyrics: Extract<LyricsProviderResult, { kind: 'synced' }> | null,
 *   activeLine: string | null,
 * }>} DetailsMenuState
 *
 * @typedef {Readonly<{
 *   onPlayPause: () => void,
 *   onNext: () => void,
 *   onPrevious: () => void,
 *   onSeek: (positionMs: number) => void,
 * }>} DetailsMenuActions
 */
const FALLBACK_ICON_NAME = 'audio-x-generic-symbolic';
const ALBUM_ART_SIZE = 120;
const LYRICS_SCROLL_HEIGHT = 200;

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
 * @param {any} _menu
 * @param {DetailsMenuActions} actions
 */
export function buildDetailsMenu(_menu, actions) {
  const section = new PopupMenu.PopupMenuSection();

  // --- Album Art + Title / Artist ---
  const headerBox = new St.BoxLayout({ style_class: 'lyricbar-details-header' });
  headerBox.set_vertical(false);

  const artBin = new St.Bin({
    style_class: 'lyricbar-details-art',
    width: ALBUM_ART_SIZE,
    height: ALBUM_ART_SIZE,
    child: new St.Icon({
      icon_name: FALLBACK_ICON_NAME,
      icon_size: ALBUM_ART_SIZE,
      style_class: 'lyricbar-details-art-icon',
    }),
  });

  const infoBox = new St.BoxLayout({ style_class: 'lyricbar-details-info' });
  infoBox.set_vertical(true);

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
  const progressBar = new St.Widget({
    style_class: 'lyricbar-details-progress-bar',
    reactive: true,
  });
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
  const playPauseButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 24 }),
    accessible_name: _t('Play', 'Oynat'),
  });
  const nextButton = new St.Button({
    style_class: 'lyricbar-details-button',
    child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 20 }),
    accessible_name: _t('Next', 'Sonraki'),
  });

  const prevClickedId = prevButton.connect('clicked', () => actions.onPrevious());
  const playPauseClickedId = playPauseButton.connect('clicked', () => actions.onPlayPause());
  const nextClickedId = nextButton.connect('clicked', () => actions.onNext());

  controlsBox.add_child(prevButton);
  controlsBox.add_child(playPauseButton);
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
  lyricsBox.set_vertical(true);
  scrollView.add_child(lyricsBox);

  const lyricsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
  lyricsItem.add_child(scrollView);
  section.addMenuItem(lyricsItem);

  // --- Internal state ---
  /** @type {string | null} */
  let currentArtUrl = null;

  return {
    section,

    /**
     * Update the details menu contents.
     *
     * @param {DetailsMenuState} state
     */
    update(state) {
      // Title + Artist
      setLabelText(titleLabel, state.title ?? '');
      setLabelText(artistLabel, state.artist ?? '');

      // Album art
      updateArt(artBin, state.artUrl, currentArtUrl);
      currentArtUrl = state.artUrl;

      // Play/Pause icon
      const isPlaying = state.playbackStatus === 'Playing';
      const ppIcon = playPauseButton.child;
      if (ppIcon) {
        setIconName(
          ppIcon,
          isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
        );
      }

      // Progress
      setLabelText(positionLabel, formatTime(state.positionMs));
      setLabelText(durationLabel, formatTime(state.durationMs));
      const fraction = computeProgressFraction(state.positionMs, state.durationMs);
      setProgressBarStyle(progressBar, fraction);

      // Lyrics
      updateLyrics(lyricsBox, scrollView, state.lyrics, state.activeLine);
    },

    destroy() {
      try {
        if (prevButton && prevClickedId) {
          prevButton.disconnect(prevClickedId);
        }
      } catch {
        /* already gone */
      }
      try {
        if (playPauseButton && playPauseClickedId) {
          playPauseButton.disconnect(playPauseClickedId);
        }
      } catch {
        /* already gone */
      }
      try {
        if (nextButton && nextClickedId) {
          nextButton.disconnect(nextClickedId);
        }
      } catch {
        /* already gone */
      }
      currentArtUrl = null;
    },
  };
}

/**
 * Update album art image.
 *
 * @param {any} artBin
 * @param {string | null} artUrl
 * @param {string | null} previousArtUrl
 */
function updateArt(artBin, artUrl, previousArtUrl) {
  if (artUrl === previousArtUrl) {
    return;
  }

  let icon = null;

  if (typeof artUrl === 'string' && artUrl !== '') {
    try {
      const gicon = Gio.Icon.new_for_string(artUrl);
      if (gicon) {
        icon = new St.Icon({
          gicon,
          icon_size: ALBUM_ART_SIZE,
          style_class: 'lyricbar-details-art-icon',
        });
      }
    } catch {
      // Gio.Icon.new_for_string can throw for unsupported URI schemes
    }
  }

  if (icon === null) {
    icon = new St.Icon({
      icon_name: FALLBACK_ICON_NAME,
      icon_size: ALBUM_ART_SIZE,
      style_class: 'lyricbar-details-art-icon',
    });
  }

  artBin.set_child(icon);
}

/**
 * Update the lyrics list.
 *
 * @param {any} lyricsBox
 * @param {any} scrollView
 * @param {Extract<LyricsProviderResult, { kind: 'synced' }> | null} lyrics
 * @param {string | null} activeLine
 */
function updateLyrics(lyricsBox, scrollView, lyrics, activeLine) {
  // Clear existing labels
  destroyChildren(lyricsBox);

  /** @type {string[]} */
  const lineTexts = [];

  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    const noLyrics = new St.Label({
      style_class: 'lyricbar-details-no-lyrics',
      text: _t('No lyrics available', 'Söz bulunamadı'),
    });
    lyricsBox.add_child(noLyrics);
    return;
  }

  for (const line of lyrics.lines) {
    const isActive = activeLine !== null && line.text === activeLine;
    const label = new St.Label({
      style_class: isActive
        ? 'lyricbar-details-lyric-line lyricbar-details-lyric-active'
        : 'lyricbar-details-lyric-line',
      text: line.text,
    });
    lyricsBox.add_child(label);
    lineTexts.push(/** @type {string} */ (line.text));
  }

  // Auto-scroll to active line
  if (activeLine !== null) {
    const activeIndex = lineTexts.indexOf(activeLine);
    if (activeIndex >= 0) {
      scrollToActiveLine(lyricsBox, scrollView, activeIndex);
    }
  }
}

/**
 * Scroll the lyrics box to bring the active line into view.
 *
 * @param {any} lyricsBox
 * @param {any} scrollView
 * @param {number} activeIndex
 */
function scrollToActiveLine(lyricsBox, scrollView, activeIndex) {
  const children = lyricsBox.get_children?.();
  if (!children || activeIndex >= children.length) {
    return;
  }

  const activeChild = children[activeIndex];
  if (!activeChild) {
    return;
  }

  try {
    const vAdjust = scrollView.get_vscroll_bar?.()?.get_adjustment?.();
    if (vAdjust) {
      const childY =
        typeof activeChild.get_y === 'function' ? activeChild.get_y() : (activeChild.y ?? 0);
      const childHeight =
        typeof activeChild.get_height === 'function'
          ? activeChild.get_height()
          : (activeChild.height ?? 20);
      const pageSize = vAdjust.page_size ?? LYRICS_SCROLL_HEIGHT;
      const newValue = Math.max(0, childY - pageSize / 2 + childHeight / 2);
      vAdjust.set_value(newValue);
    }
  } catch {
    // scroll adjustment not available; non-critical
  }
}

/**
 * @param {number | null} ms
 * @returns {string}
 */
function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return '0:00';
  }
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * @param {number | null} positionMs
 * @param {number | null} durationMs
 * @returns {number}
 */
function computeProgressFraction(positionMs, durationMs) {
  if (
    typeof positionMs !== 'number' ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(positionMs) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return 0;
  }
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

/**
 * @param {any} bar
 * @param {number} fraction 0..1
 */
function setProgressBarStyle(bar, fraction) {
  bar.set_style(`background-color: rgba(255,255,255,0.3); width: 100%; height: 4px;`);
  // The fill is rendered as a child. GNOME Shell CSS doesn't support
  // pseudo-elements, so we overlay a child widget sized by fraction.
  setProgressBarFill(bar, fraction);
}

/**
 * @param {any} bar
 * @param {number} fraction
 */
function setProgressBarFill(bar, fraction) {
  // Remove old fill child if present
  destroyChildren(bar);

  const fill = new St.Widget({
    style_class: 'lyricbar-details-progress-fill',
    style: `background-color: rgba(255,255,255,0.8); width: ${Math.round(fraction * 100)}%; height: 100%; border-radius: 2px;`,
  });
  bar.add_child(fill);
}

/**
 * Safely destroy all children of an actor.
 *
 * @param {any} actor
 */
function destroyChildren(actor) {
  if (!actor) {
    return;
  }
  try {
    if (typeof actor.destroy_all_children === 'function') {
      actor.destroy_all_children();
    } else if (typeof actor.get_children === 'function') {
      const children = actor.get_children();
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child.destroy === 'function') {
            child.destroy();
          }
        }
      }
    }
  } catch {
    // ignore non-critical layout errors
  }
}

/**
 * @param {any} label
 * @param {string} text
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
 */
function setIconName(icon, name) {
  try {
    icon.set_icon_name(name);
  } catch {
    Reflect.set(icon, 'icon_name', name);
  }
}
