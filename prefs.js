import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
  DEFAULT_CUSTOM_TEXT_COLOR,
  isHexColor,
  TEXT_COLOR_MODES,
  textColorModeIndex,
} from './src/domain/settings/appearance.js';
import { _t } from './src/runtime/i18n.js';

/**
 * @typedef {{
 *   red: number,
 *   green: number,
 *   blue: number,
 *   alpha: number,
 * }} RgbaColor
 */

const UPDATE_CHECK_INTERVAL_S = 86400;
const GITHUB_RELEASES_URL = 'https://github.com/fikrilal/gnome-lyricbar/releases/latest';
const STATE_DIR = GLib.build_filenamev([GLib.get_user_state_dir(), 'lyricbar']);
const UPDATE_STATE_FILE = GLib.build_filenamev([STATE_DIR, 'update-check.json']);
const UPDATER_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  '.local',
  'bin',
  'lyricbar-update',
]);

export default class LyricBarPreferences extends ExtensionPreferences {
  /**
   * @param {any} window
   * @returns {void}
   */
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const metadata = /** @type {Record<string, unknown>} */ (
      /** @type {{ metadata?: unknown }} */ (this).metadata ?? {}
    );
    /** @type {any[]} */
    const connections = [];

    const page = new Adw.PreferencesPage({
      title: 'Better Lyrics',
      icon_name: 'audio-x-generic-symbolic',
    });

    // 1. Display Group
    const displayGroup = new Adw.PreferencesGroup({
      title: _t('Display', 'Gösterim'),
      description: _t(
        'Control how Better Lyrics appears in the GNOME top bar.',
        "Better Lyrics'in GNOME üst barında nasıl görüneceğini kontrol edin.",
      ),
    });

    // panel-position: ComboRow
    const positions = ['left', 'center', 'right'];
    const panelPositionRow = new Adw.ComboRow({
      title: _t('Panel position', 'Panel konumu'),
      subtitle: _t(
        'Where the Better Lyrics indicator is placed in the top bar.',
        'Better Lyrics göstergesinin üst bara nereye yerleştirileceği.',
      ),
      model: new Gtk.StringList({
        strings: [_t('Left', 'Sol'), _t('Center', 'Orta'), _t('Right', 'Sağ')],
      }),
    });
    const currentPos = settings.get_string('panel-position');
    const posIndex = positions.indexOf(currentPos);
    if (posIndex !== -1) {
      panelPositionRow.selected = posIndex;
    }
    const posNotifyId = panelPositionRow.connect('notify::selected', () => {
      const { selected } = panelPositionRow;
      if (selected >= 0 && selected < positions.length) {
        settings.set_string('panel-position', positions[selected]);
      }
    });
    connections.push([panelPositionRow, posNotifyId]);

    const posChangedId = settings.connect('changed::panel-position', () => {
      const currentPos = settings.get_string('panel-position');
      const posIndex = positions.indexOf(currentPos);
      if (posIndex !== -1 && panelPositionRow.selected !== posIndex) {
        panelPositionRow.selected = posIndex;
      }
    });
    connections.push([settings, posChangedId]);

    // max-width: SpinRow
    const maxWidthRow = new Adw.SpinRow({
      title: _t('Maximum width', 'Maksimum genişlik'),
      subtitle: _t(
        'Maximum top-bar label width in pixels.',
        'Piksel cinsinden maksimum üst bar etiket genişliği.',
      ),
      adjustment: new Gtk.Adjustment({
        lower: 120,
        upper: 720,
        step_increment: 10,
        page_increment: 50,
        value: settings.get_int('max-width'),
      }),
    });
    settings.bind('max-width', maxWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);

    // auto-width: SwitchRow
    const autoWidthRow = new Adw.SwitchRow({
      title: _t('Auto width', 'Otomatik genişlik'),
      subtitle: _t(
        'Automatically adjust label width to fit lyrics text (up to maximum width).',
        'Etiket genişliğini şarkı sözü metnine otomatik ayarla (maksimum genişliğe kadar).',
      ),
      active: settings.get_boolean('auto-width'),
    });
    settings.bind('auto-width', autoWidthRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    // text-align: ComboRow
    const alignments = ['left', 'center', 'right'];
    const textAlignRow = new Adw.ComboRow({
      title: _t('Text alignment', 'Metin hizalama'),
      subtitle: _t(
        'Horizontal alignment of the lyric text within the indicator.',
        'Gösterge içindeki şarkı sözü metninin yatay hizalaması.',
      ),
      model: new Gtk.StringList({
        strings: [_t('Left', 'Sol'), _t('Center', 'Orta'), _t('Right', 'Sağ')],
      }),
    });
    const currentAlign = settings.get_string('text-align');
    const alignIndex = alignments.indexOf(currentAlign);
    if (alignIndex !== -1) {
      textAlignRow.selected = alignIndex;
    }
    const alignNotifyId = textAlignRow.connect('notify::selected', () => {
      const { selected } = textAlignRow;
      if (selected >= 0 && selected < alignments.length) {
        settings.set_string('text-align', alignments[selected]);
      }
    });
    connections.push([textAlignRow, alignNotifyId]);

    const alignChangedId = settings.connect('changed::text-align', () => {
      const currentAlign = settings.get_string('text-align');
      const alignIndex = alignments.indexOf(currentAlign);
      if (alignIndex !== -1 && textAlignRow.selected !== alignIndex) {
        textAlignRow.selected = alignIndex;
      }
    });
    connections.push([settings, alignChangedId]);

    // fallback-mode: ComboRow
    const fallbackModes = ['track', 'idle', 'hidden'];
    const fallbackModeRow = new Adw.ComboRow({
      title: _t('Fallback mode', 'Alternatif mod'),
      subtitle: _t(
        'Display behavior when synced lyrics are unavailable.',
        'Eşzamanlı şarkı sözleri bulunamadığında gösterilecek içerik.',
      ),
      model: new Gtk.StringList({
        strings: [
          _t('Show track title', 'Şarkıyı göster'),
          _t('Show static idle text', 'Boştaki metni göster'),
          _t('Hide indicator', 'Gizle'),
        ],
      }),
    });
    const currentFallback = settings.get_string('fallback-mode');
    const fallbackIndex = fallbackModes.indexOf(currentFallback);
    if (fallbackIndex !== -1) {
      fallbackModeRow.selected = fallbackIndex;
    }
    const fallbackNotifyId = fallbackModeRow.connect('notify::selected', () => {
      const { selected } = fallbackModeRow;
      if (selected >= 0 && selected < fallbackModes.length) {
        settings.set_string('fallback-mode', fallbackModes[selected]);
      }
    });
    connections.push([fallbackModeRow, fallbackNotifyId]);

    const fallbackChangedId = settings.connect('changed::fallback-mode', () => {
      const currentFallback = settings.get_string('fallback-mode');
      const fallbackIndex = fallbackModes.indexOf(currentFallback);
      if (fallbackIndex !== -1 && fallbackModeRow.selected !== fallbackIndex) {
        fallbackModeRow.selected = fallbackIndex;
      }
    });
    connections.push([settings, fallbackChangedId]);

    const showSettingsIconRow = new Adw.SwitchRow({
      title: _t('Show settings icon', 'Ayarlar simgesini göster'),
      subtitle: _t(
        'Show a separate top-bar shortcut to Better Lyrics preferences.',
        'Better Lyrics ayarlarına giden ayrı bir üst bar kısayolu göster.',
      ),
    });
    settings.bind(
      'show-settings-icon',
      showSettingsIconRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    );

    displayGroup.add(panelPositionRow);
    displayGroup.add(maxWidthRow);
    displayGroup.add(autoWidthRow);
    displayGroup.add(textAlignRow);
    displayGroup.add(fallbackModeRow);
    displayGroup.add(showSettingsIconRow);

    // 1.5 Appearance Group
    const appearanceGroup = new Adw.PreferencesGroup({
      title: _t('Appearance', 'Görünüm'),
      description: _t('Customize lyric text style.', 'Şarkı sözü metin stilini özelleştirin.'),
    });

    const textColorPresetRow = new Adw.ComboRow({
      title: _t('Text color preset', 'Metin renk şablonu'),
      subtitle: _t(
        'Preset text color style for the lyric label.',
        'Şarkı sözü etiketi için hazır metin rengi stili.',
      ),
      model: new Gtk.StringList({
        strings: [
          _t('Default (White)', 'Varsayılan (Beyaz)'),
          _t('Theme default', 'Sistem teması varsayılanı'),
          _t('White', 'Beyaz'),
          _t('Black', 'Siyah'),
          _t('Custom color', 'Özel renk'),
        ],
      }),
    });
    const currentColorType = settings.get_string('style-text-color-type');
    const colorTypeIndex = textColorModeIndex(currentColorType);
    if (colorTypeIndex !== -1) {
      textColorPresetRow.selected = colorTypeIndex;
    }

    const textColorCustomRow = new Adw.EntryRow({
      title: _t('Custom text color (HEX)', 'Özel metin rengi (HEX)'),
      show_apply_button: true,
    });
    textColorCustomRow.text = settings.get_string('style-text-color-custom');

    const colorPickerButton = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({
        title: _t('Pick text color', 'Metin rengi seçin'),
        modal: true,
        with_alpha: false,
      }),
      rgba: rgbaFromHex(settings.get_string('style-text-color-custom')),
      valign: Gtk.Align.CENTER,
    });
    textColorCustomRow.add_suffix(colorPickerButton);

    const updateCustomColorVisibility = () => {
      textColorCustomRow.visible = textColorPresetRow.selected === 4;
    };
    updateCustomColorVisibility();

    const colorTypeNotifyId = textColorPresetRow.connect('notify::selected', () => {
      const { selected } = textColorPresetRow;
      if (selected >= 0 && selected < TEXT_COLOR_MODES.length) {
        settings.set_string('style-text-color-type', TEXT_COLOR_MODES[selected]);
        updateCustomColorVisibility();
      }
    });
    connections.push([textColorPresetRow, colorTypeNotifyId]);

    const colorTypeChangedId = settings.connect('changed::style-text-color-type', () => {
      const current = settings.get_string('style-text-color-type');
      const idx = textColorModeIndex(current);
      if (idx !== -1 && textColorPresetRow.selected !== idx) {
        textColorPresetRow.selected = idx;
        updateCustomColorVisibility();
      }
    });
    connections.push([settings, colorTypeChangedId]);

    const textColorCustomApplyId = textColorCustomRow.connect('apply', () => {
      const text = textColorCustomRow.text.trim();
      if (isHexColor(text)) {
        settings.set_string('style-text-color-custom', text);
      } else {
        textColorCustomRow.text = settings.get_string('style-text-color-custom');
      }
    });
    connections.push([textColorCustomRow, textColorCustomApplyId]);

    const textColorPickerChangedId = colorPickerButton.connect('notify::rgba', () => {
      const hex = hexFromRgba(colorPickerButton.rgba);
      if (settings.get_string('style-text-color-custom') !== hex) {
        settings.set_string('style-text-color-custom', hex);
      }
    });
    connections.push([colorPickerButton, textColorPickerChangedId]);

    const textColorCustomChangedId = settings.connect('changed::style-text-color-custom', () => {
      const current = settings.get_string('style-text-color-custom');
      if (textColorCustomRow.text !== current) {
        textColorCustomRow.text = current;
      }
      if (hexFromRgba(colorPickerButton.rgba) !== current) {
        colorPickerButton.rgba = rgbaFromHex(current);
      }
    });
    connections.push([settings, textColorCustomChangedId]);

    const textShadowRow = new Adw.SwitchRow({
      title: _t('Text drop shadow (Glow)', 'Metin gölgesi (Parlama)'),
      subtitle: _t(
        'Show a drop shadow behind the lyric text for readability.',
        'Okunabilirliği artırmak için metnin arkasında gölge/parlama göster.',
      ),
    });
    settings.bind('style-text-shadow', textShadowRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const glowStrengthRow = new Adw.SpinRow({
      title: _t('Glow strength', 'Parlama gücü'),
      subtitle: _t(
        'Adjust the intensity of the text shadow glow.',
        'Metin gölgesi parlama yoğunluğunu ayarlayın.',
      ),
      digits: 1,
      adjustment: new Gtk.Adjustment({
        lower: 0.0,
        upper: 2.0,
        step_increment: 0.1,
        page_increment: 0.5,
        value: settings.get_double('style-glow-strength'),
      }),
    });
    settings.bind('style-glow-strength', glowStrengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);

    const updateGlowStrengthVisibility = () => {
      glowStrengthRow.visible = textShadowRow.active;
    };
    updateGlowStrengthVisibility();
    const shadowActiveId = textShadowRow.connect('notify::active', () => {
      updateGlowStrengthVisibility();
    });
    connections.push([textShadowRow, shadowActiveId]);

    appearanceGroup.add(textColorPresetRow);
    appearanceGroup.add(textColorCustomRow);
    appearanceGroup.add(textShadowRow);
    appearanceGroup.add(glowStrengthRow);

    // 2. Behavior Group
    const behaviorGroup = new Adw.PreferencesGroup({
      title: _t('Behavior', 'Davranış'),
      description: _t(
        'Customize lyrics behavior and player connection.',
        'Şarkı sözü davranışını ve oynatıcı bağlantısını özelleştirin.',
      ),
    });

    // player-priority: EntryRow
    const playerPriorityRow = new Adw.EntryRow({
      title: _t('Player priority (comma-separated)', 'Oynatıcı önceliği (virgülle ayrılmış)'),
      show_apply_button: true,
    });
    const currentPriority = settings.get_strv('player-priority').join(', ');
    playerPriorityRow.text = currentPriority;
    const priorityApplyId = playerPriorityRow.connect('apply', () => {
      const parts = playerPriorityRow.text
        .split(',')
        .map((/** @type {string} */ p) => p.trim())
        .filter((/** @type {string} */ p) => p !== '');
      settings.set_strv('player-priority', parts);
    });
    connections.push([playerPriorityRow, priorityApplyId]);

    const priorityChangedId = settings.connect('changed::player-priority', () => {
      const currentPriority = settings.get_strv('player-priority').join(', ');
      if (playerPriorityRow.text !== currentPriority) {
        playerPriorityRow.text = currentPriority;
      }
    });
    connections.push([settings, priorityChangedId]);

    // cache-enabled: SwitchRow
    const cacheEnabledRow = new Adw.SwitchRow({
      title: _t('Cache lyrics', 'Şarkı sözlerini önbelleğe al'),
      subtitle: _t(
        'Whether lyric lookup results should be cached locally.',
        'Şarkı sözü arama sonuçlarının yerel olarak önbelleğe alınıp alınmayacağı.',
      ),
    });
    settings.bind('cache-enabled', cacheEnabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    behaviorGroup.add(playerPriorityRow);

    // browser-player-service: ComboRow
    const browserPlayerServices = ['auto', 'spotify', 'youtube-music', 'apple-music', 'generic'];
    const browserPlayerServiceRow = new Adw.ComboRow({
      title: _t('Browser player service', 'Tarayıcı oynatıcı servisi'),
      subtitle: _t(
        'How browser media players should be interpreted.',
        'Tarayıcı medya oynatıcılarının nasıl yorumlanacağı.',
      ),
      model: new Gtk.StringList({
        strings: [
          _t('Auto detect', 'Otomatik algıla'),
          'Spotify Web',
          'YouTube Music',
          'Apple Music',
          _t('Generic browser', 'Genel tarayıcı'),
        ],
      }),
    });
    const currentBrowserPlayerService = settings.get_string('browser-player-service');
    const browserPlayerServiceIndex = browserPlayerServices.indexOf(currentBrowserPlayerService);
    if (browserPlayerServiceIndex !== -1) {
      browserPlayerServiceRow.selected = browserPlayerServiceIndex;
    }
    const browserPlayerServiceNotifyId = browserPlayerServiceRow.connect('notify::selected', () => {
      const { selected } = browserPlayerServiceRow;
      if (selected >= 0 && selected < browserPlayerServices.length) {
        settings.set_string('browser-player-service', browserPlayerServices[selected]);
      }
    });
    connections.push([browserPlayerServiceRow, browserPlayerServiceNotifyId]);

    const browserPlayerServiceChangedId = settings.connect(
      'changed::browser-player-service',
      () => {
        const currentBrowserPlayerService = settings.get_string('browser-player-service');
        const browserPlayerServiceIndex = browserPlayerServices.indexOf(
          currentBrowserPlayerService,
        );
        if (
          browserPlayerServiceIndex !== -1 &&
          browserPlayerServiceRow.selected !== browserPlayerServiceIndex
        ) {
          browserPlayerServiceRow.selected = browserPlayerServiceIndex;
        }
      },
    );
    connections.push([settings, browserPlayerServiceChangedId]);

    behaviorGroup.add(browserPlayerServiceRow);
    behaviorGroup.add(cacheEnabledRow);

    // lyrics-source: ComboRow
    const lyricsSources = ['auto', 'better-lyrics', 'lrclib'];
    const lyricsSourceRow = new Adw.ComboRow({
      title: _t('Lyrics provider', 'Şarkı sözü kaynağı'),
      subtitle: _t(
        'Choose where synced lyrics are fetched from.',
        'Senkronize şarkı sözlerinin nereden alınacağını seçin.',
      ),
      model: new Gtk.StringList({
        strings: [
          _t(
            'Auto (Unison -> Better Lyrics -> LRCLIB)',
            'Otomatik (Unison -> Better Lyrics -> LRCLIB)',
          ),
          _t(
            'Unison + Better Lyrics (Word-by-word synced)',
            'Unison + Better Lyrics (Kelime kelime senkronize)',
          ),
          'LRCLIB',
        ],
      }),
    });
    const currentLyricsSource = settings.get_string('lyrics-source');
    const lyricsSourceIndex = lyricsSources.indexOf(currentLyricsSource);
    if (lyricsSourceIndex !== -1) {
      lyricsSourceRow.selected = lyricsSourceIndex;
    }
    const lyricsSourceNotifyId = lyricsSourceRow.connect('notify::selected', () => {
      const { selected } = lyricsSourceRow;
      if (selected >= 0 && selected < lyricsSources.length) {
        settings.set_string('lyrics-source', lyricsSources[selected]);
      }
    });
    connections.push([lyricsSourceRow, lyricsSourceNotifyId]);

    const lyricsSourceChangedId = settings.connect('changed::lyrics-source', () => {
      const current = settings.get_string('lyrics-source');
      const idx = lyricsSources.indexOf(current);
      if (idx !== -1 && lyricsSourceRow.selected !== idx) {
        lyricsSourceRow.selected = idx;
      }
    });
    connections.push([settings, lyricsSourceChangedId]);

    behaviorGroup.add(lyricsSourceRow);

    // 3. Debugging Group
    const debuggingGroup = new Adw.PreferencesGroup({
      title: _t('Debugging', 'Hata Ayıklama'),
      description: _t('Troubleshoot issues.', 'Sorunları giderin.'),
    });

    // debug-logging: SwitchRow
    const debugLoggingRow = new Adw.SwitchRow({
      title: _t('Debug logging', 'Hata ayıklama günlüğü'),
      subtitle: _t(
        'Whether verbose diagnostic logging should be enabled.',
        'Detaylı teşhis günlüklerinin etkinleştirilip etkinleştirilmeyeceği.',
      ),
    });
    settings.bind('debug-logging', debugLoggingRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    debuggingGroup.add(debugLoggingRow);

    const copyDiagnosticsRow = new Adw.ActionRow({
      title: _t('Copy diagnostics', 'Teşhis bilgilerini kopyala'),
      subtitle: _t(
        'Copy safe extension settings for bug reports.',
        'Hata raporları için güvenli uzantı ayarlarını kopyalayın.',
      ),
    });
    const copyDiagnosticsButton = new Gtk.Button({
      icon_name: 'edit-copy-symbolic',
      valign: Gtk.Align.CENTER,
      tooltip_text: _t('Copy diagnostics', 'Teşhis bilgilerini kopyala'),
    });
    const copyDiagnosticsId = copyDiagnosticsButton.connect('clicked', () => {
      window.get_clipboard().set(buildDiagnosticsMarkdown(metadata, settings));
      copyDiagnosticsButton.tooltip_text = _t('Copied diagnostics', 'Teşhis bilgileri kopyalandı');
    });
    connections.push([copyDiagnosticsButton, copyDiagnosticsId]);
    copyDiagnosticsRow.add_suffix(copyDiagnosticsButton);
    debuggingGroup.add(copyDiagnosticsRow);

    const openIssueRow = new Adw.ActionRow({
      title: _t('Open issue', 'Sorun bildir'),
      subtitle: _t(
        'Open GitHub issue tracker in your browser.',
        'Tarayıcınızda GitHub sorun takipçisini açın.',
      ),
    });
    const openIssueButton = new Gtk.Button({
      icon_name: 'dialog-question-symbolic',
      valign: Gtk.Align.CENTER,
      tooltip_text: _t('Open issue', 'Sorun bildir'),
    });
    const openIssueId = openIssueButton.connect('clicked', () => {
      Gtk.show_uri(
        window,
        `${readMetadataText(metadata, 'url', 'https://github.com/fikrilal/gnome-lyricbar')}/issues/new`,
        0,
      );
    });
    connections.push([openIssueButton, openIssueId]);
    openIssueRow.add_suffix(openIssueButton);
    debuggingGroup.add(openIssueRow);

    // 4. About Group
    const aboutGroup = new Adw.PreferencesGroup({
      title: _t('About', 'Hakkında'),
    });

    const currentVersion = readMetadataText(metadata, 'version-name', 'Unknown');

    const versionRow = new Adw.ActionRow({
      title: _t('Version', 'Sürüm'),
      subtitle: currentVersion,
    });

    const updateRow = new Adw.ActionRow({
      title: _t('Update available', 'Sürüm güncellemesi mevcut'),
      subtitle: _t('Checking for updates...', 'Güncellemeler kontrol ediliyor...'),
    });
    updateRow.visible = true;

    const releasesUrl = `${readMetadataText(metadata, 'url', 'https://github.com/fikrilal/gnome-lyricbar')}/releases`;
    updateRow.activatable = true;
    const updateActivateId = updateRow.connect('activated', () => {
      Gtk.show_uri(window, releasesUrl, 0);
    });
    connections.push([updateRow, updateActivateId]);

    const openButton = new Gtk.Button({
      icon_name: 'external-link-symbolic',
      valign: Gtk.Align.CENTER,
      tooltip_text: _t('View releases', 'Sürümleri görüntüle'),
    });
    const openButtonId = openButton.connect('clicked', () => {
      Gtk.show_uri(window, releasesUrl, 0);
    });
    connections.push([openButton, openButtonId]);
    updateRow.add_suffix(openButton);

    const updaterExists = GLib.file_test(UPDATER_PATH, GLib.FileTest.EXISTS);
    /** @type {any | null} */
    let updateNowButton = null;
    /** @type {boolean} */
    let windowDestroyed = false;

    if (updaterExists) {
      updateNowButton = new Gtk.Button({
        label: _t('Update Now', 'Şimdi Güncelle'),
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
      });
      const updateNowId = updateNowButton.connect('clicked', async () => {
        updateNowButton.sensitive = false;
        updateNowButton.label = _t('Updating...', 'Güncelleniyor...');
        updateRow.subtitle = _t('Running updater...', 'Güncelleyici çalıştırılıyor...');

        const result = await runSubprocess(UPDATER_PATH, []);

        if (windowDestroyed) {
          return;
        }

        if (result.ok) {
          updateRow.subtitle = _t(
            'Updated! Restart GNOME Shell to apply.',
            "Güncellendi! Uygulamak için GNOME Shell'i yeniden başlatın.",
          );
          updateNowButton.label = _t('Done', 'Bitti');
        } else {
          updateRow.subtitle = _t(
            'Update failed. Try again or visit releases page.',
            'Güncelleme başarısız oldu. Tekrar deneyin veya sürümler sayfasını ziyaret edin.',
          );
          updateNowButton.label = _t('Retry', 'Tekrar Dene');
          updateNowButton.sensitive = true;
        }
      });
      connections.push([updateNowButton, updateNowId]);
      updateRow.add_suffix(updateNowButton);
    }

    checkForUpdate(currentVersion, (latestVersion) => {
      if (windowDestroyed) {
        return;
      }
      if (latestVersion) {
        updateRow.subtitle = _t(
          `${latestVersion} is available on GitHub`,
          `${latestVersion} GitHub üzerinde mevcut`,
        );
        if (!updaterExists) {
          updateRow.subtitle += _t(
            '. Install auto-updater to enable Update Now.',
            '. Şimdi Güncelle özelliğini etkinleştirmek için otomatik güncelleyiciyi yükleyin.',
          );
        }
      } else {
        updateRow.visible = false;
      }
    });

    const uuidRow = new Adw.ActionRow({
      title: _t('Extension UUID', 'Uzantı UUID'),
      subtitle: readMetadataText(metadata, 'uuid', 'betterlyricsbar@furkansa50'),
    });

    const websiteRow = new Adw.ActionRow({
      title: _t('Website', 'Web sitesi'),
      subtitle: readMetadataText(
        metadata,
        'url',
        'https://github.com/furkansa50/bettergnome-lyricbar',
      ),
    });
    websiteRow.activatable = true;
    const websiteActivateId = websiteRow.connect('activated', () => {
      Gtk.show_uri(window, websiteRow.subtitle, 0);
    });
    connections.push([websiteRow, websiteActivateId]);

    aboutGroup.add(versionRow);
    aboutGroup.add(updateRow);
    aboutGroup.add(uuidRow);
    aboutGroup.add(websiteRow);

    page.add(displayGroup);
    page.add(appearanceGroup);
    page.add(behaviorGroup);
    page.add(debuggingGroup);
    page.add(aboutGroup);

    window.add(page);

    // Disconnect all listeners when the window is destroyed
    const windowDestroyId = window.connect('destroy', () => {
      windowDestroyed = true;
      for (const [obj, id] of connections) {
        try {
          obj.disconnect(id);
        } catch {
          // Ignore if object is already finalized
        }
      }
      window.disconnect(windowDestroyId);
    });
  }
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function readMetadataText(metadata, key, fallback) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
function runSubprocess(command, args) {
  return new Promise((resolve) => {
    try {
      const proc = new Gio.Subprocess({
        argv: [command, ...args],
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      });
      proc.init(null);

      proc.communicate_utf8_async(
        null,
        null,
        /**
         * @param {unknown} _source
         * @param {unknown} result
         * @returns {void}
         */
        (_source, result) => {
          try {
            const [, stdout, stderr] = proc.communicate_utf8_finish(result);
            resolve({
              ok: proc.get_successful(),
              stdout: stdout ?? '',
              stderr: stderr ?? '',
            });
          } catch (e) {
            resolve({ ok: false, stdout: '', stderr: String(e) });
          }
        },
      );
    } catch (e) {
      resolve({ ok: false, stdout: '', stderr: String(e) });
    }
  });
}

/**
 * @returns {{ lastCheck: number, latestVersion: string } | null}
 */
function readUpdateState() {
  try {
    const [ok, contents] = GLib.file_get_contents(UPDATE_STATE_FILE);
    if (!ok || !contents) {
      return null;
    }
    const decoder = new TextDecoder('utf-8');
    return JSON.parse(decoder.decode(contents));
  } catch {
    return null;
  }
}

/**
 * @param {{ lastCheck: number, latestVersion: string }} state
 * @returns {void}
 */
function writeUpdateState(state) {
  try {
    GLib.mkdir_with_parents(STATE_DIR, 0o755);
    const payload = JSON.stringify(state, null, 2);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(payload);
    GLib.file_set_contents(UPDATE_STATE_FILE, bytes);
  } catch {
    // Silently ignore write failures
  }
}

/**
 * @param {string} current
 * @param {string} latest
 * @returns {boolean}
 */
function isNewerVersion(current, latest) {
  const normalize = (/** @type {string} */ v) => v.replace(/^v/, '').trim();
  const currentParts = normalize(current).split('.').map(Number);
  const latestParts = normalize(latest).split('.').map(Number);
  const maxLen = Math.max(currentParts.length, latestParts.length);
  for (let i = 0; i < maxLen; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) {
      return true;
    }
    if (l < c) {
      return false;
    }
  }
  return false;
}

/**
 * @param {string} currentVersion
 * @param {(latestVersion: string | null) => void} callback
 * @returns {void}
 */
function checkForUpdate(currentVersion, callback) {
  const state = readUpdateState();
  const now = Math.floor(Date.now() / 1000);

  if (state && now - state.lastCheck < UPDATE_CHECK_INTERVAL_S) {
    callback(isNewerVersion(currentVersion, state.latestVersion) ? state.latestVersion : null);
    return;
  }

  const session = new Soup.Session({ user_agent: 'lyricbar-prefs/1.0' });
  const message = Soup.Message.new('HEAD', GITHUB_RELEASES_URL);
  if (!message) {
    callback(null);
    return;
  }

  session.send_and_read_async(
    message,
    GLib.PRIORITY_DEFAULT,
    null,
    /**
     * @param {unknown} _source
     * @param {unknown} result
     * @returns {void}
     */
    (_source, result) => {
      try {
        session.send_and_read_finish(result);
        const uri = message.get_uri()?.to_string?.() ?? '';
        const match = uri.match(/\/tag\/([^/?#]+)/);
        const latestVersion = match ? match[1] : null;

        if (latestVersion) {
          writeUpdateState({ lastCheck: now, latestVersion });
        }

        callback(
          latestVersion && isNewerVersion(currentVersion, latestVersion) ? latestVersion : null,
        );
      } catch {
        callback(null);
      }
    },
  );
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {{
 *   get_string(key: string): string,
 *   get_int(key: string): number,
 *   get_strv(key: string): string[],
 *   get_boolean(key: string): boolean,
 * }} settings
 * @returns {string}
 */
function buildDiagnosticsMarkdown(metadata, settings) {
  return [
    '## Better Lyrics diagnostics',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Version | ${escapeMarkdownTable(readMetadataText(metadata, 'version-name', 'Unknown'))} |`,
    `| UUID | ${escapeMarkdownTable(readMetadataText(metadata, 'uuid', 'betterlyricsbar@furkansa50'))} |`,
    `| URL | ${escapeMarkdownTable(readMetadataText(metadata, 'url', 'https://github.com/furkansa50/bettergnome-lyricbar'))} |`,
    `| Shell compatibility | ${escapeMarkdownTable(readShellVersions(metadata))} |`,
    `| Panel position | ${escapeMarkdownTable(settings.get_string('panel-position'))} |`,
    `| Text alignment | ${escapeMarkdownTable(settings.get_string('text-align'))} |`,
    `| Maximum width | ${settings.get_int('max-width')} |`,
    `| Fallback mode | ${escapeMarkdownTable(settings.get_string('fallback-mode'))} |`,
    `| Show settings icon | ${formatBoolean(settings.get_boolean('show-settings-icon'))} |`,
    `| Player priority | ${escapeMarkdownTable(settings.get_strv('player-priority').join(', '))} |`,
    `| Browser player service | ${escapeMarkdownTable(settings.get_string('browser-player-service'))} |`,
    `| Cache enabled | ${formatBoolean(settings.get_boolean('cache-enabled'))} |`,
    `| Debug logging | ${formatBoolean(settings.get_boolean('debug-logging'))} |`,
    `| Style text color type | ${escapeMarkdownTable(settings.get_string('style-text-color-type'))} |`,
    `| Style text color custom | ${escapeMarkdownTable(settings.get_string('style-text-color-custom'))} |`,
    `| Style text shadow | ${formatBoolean(settings.get_boolean('style-text-shadow'))} |`,
    '',
    'This diagnostic block intentionally excludes lyrics, listening history, logs, local file paths, and MPRIS metadata.',
  ].join('\n');
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {string}
 */
function readShellVersions(metadata) {
  const value = metadata['shell-version'];
  if (!Array.isArray(value)) {
    return 'Unknown';
  }

  const versions = value.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  return versions.length === 0 ? 'Unknown' : versions.join(', ');
}

/**
 * @param {boolean} value
 * @returns {string}
 */
function formatBoolean(value) {
  return value ? 'yes' : 'no';
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeMarkdownTable(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * @param {string} hex
 * @returns {RgbaColor}
 */
function rgbaFromHex(hex) {
  const rgba = new Gdk.RGBA();
  rgba.parse(isHexColor(hex) ? hex.trim() : DEFAULT_CUSTOM_TEXT_COLOR);
  rgba.alpha = 1;
  return rgba;
}

/**
 * @param {RgbaColor} rgba
 * @returns {string}
 */
function hexFromRgba(rgba) {
  return `#${channelToHex(rgba.red)}${channelToHex(rgba.green)}${channelToHex(rgba.blue)}`;
}

/**
 * @param {number} channel
 * @returns {string}
 */
function channelToHex(channel) {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');
}
