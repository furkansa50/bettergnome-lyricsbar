# Better Lyrics Bar

Better Lyrics Bar is a GNOME Shell extension that displays synchronized live lyrics in the top bar for MPRIS-compatible music players.

It is built for GNOME Shell 46–50 and supports Spotify Desktop, Spotify Web, YouTube Music Web, Apple Music Web, and other MPRIS players. Features include word-by-word synced lyrics, a multi-provider fallback engine (Musixmatch, Better Lyrics, LRCLIB), dynamic auto-width, and an interactive song details popup.

![Better Lyrics Bar screenshot](docs/assets/lyricbar-panel.png)

![Better Lyrics Bar demo](docs/assets/lyricbar-demo.gif)

## Features

- **Word-by-Word Synced Lyrics**: Real-time word highlighting and line tracking with smooth CSS transitions and glow effects.
- **Multi-Provider Pipeline**: Intelligent lyric lookup cascading across Musixmatch (RichSync and LRC), Better Lyrics API, and LRCLIB with local caching.
- **Dynamic Auto-Width**: Top-bar label automatically adjusts width to fit lyric text up to a configurable maximum width.
- **Interactive Details Popup**: Click the top bar indicator to view track artwork, artist/album metadata, playback controls (Play/Pause, Next, Previous), a seek slider, volume control, and active lyrics source switcher.
- **Broad MPRIS Player Support**: Seamless integration with Spotify Desktop, Spotify Web, YouTube Music Web, Apple Music Web, and generic MPRIS media players.
- **Deep Customization**: Preferences for text color (system, presets, or custom HEX), text shadow and glow intensity, panel position (left, center, right), text alignment, fallback mode, and cache toggles.
- **Robust Shell Architecture**: Isolated domain logic, guarded async callbacks, and strict lifecycle cleanup on disable.

## Compatibility

| Target               | Status        |
| -------------------- | ------------- |
| GNOME Shell 46–50    | Supported     |
| Ubuntu 24.04         | Supported     |
| Fedora GNOME         | Supported     |
| Spotify Desktop      | Supported     |
| Spotify Web          | Supported     |
| YouTube Music Web    | Supported     |
| Apple Music Web      | Supported     |
| Other MPRIS players  | Best effort   |
| Non-GNOME desktops   | Not supported |
| Browser/website APIs | Not used      |

Browser player support is powered by the browser's native MPRIS integration. Better Lyrics Bar does not scrape tabs, read DOM content, or access private player credentials.

## Install

Recommended install (includes automatic daily updates):

```bash
curl -fsSL https://raw.githubusercontent.com/furkansa50/bettergnome-lyrics/main/scripts/install.sh | bash -s -- --install-updater
```

Install without auto-update:

```bash
curl -fsSL https://raw.githubusercontent.com/furkansa50/bettergnome-lyrics/main/scripts/install.sh | bash
```

Open preferences:

```bash
gnome-extensions prefs betterlyricsbar@furkansa50
```

Manual update command:

```bash
~/.local/bin/lyricbar-update
```

Uninstall:

```bash
gnome-extensions disable betterlyricsbar@furkansa50
rm -rf ~/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50
curl -fsSL https://raw.githubusercontent.com/furkansa50/bettergnome-lyrics/main/scripts/install.sh | bash -s -- --uninstall-updater
```

## Development

Requirements:

- GNOME Shell 46–50
- Node.js 22+
- `glib-compile-schemas`
- `zip`

Build and install locally:

```bash
npm ci
npm run verify
gnome-extensions install --force dist/betterlyricsbar@furkansa50.zip
gnome-extensions enable betterlyricsbar@furkansa50
```

Or install unpacked for local development:

```bash
npm run install:local
```

The generated release bundle is written to `dist/betterlyricsbar@furkansa50.zip`.

## Privacy

Better Lyrics Bar does not use telemetry and does not require account credentials. For lyric lookups, track metadata (artist, title, album, duration) is queried against public lyrics services. See [Privacy](docs/privacy.md).

## Troubleshooting

If the panel is blank, lyrics do not sync, or the wrong player is selected, see [Troubleshooting](docs/operations/troubleshooting.md).

## Documentation

- [Product overview](docs/product.md)
- [Engineering proposal](docs/engineering/proposal.md)
- [Player support](docs/players/README.md)
- [Player profile architecture](docs/players/profile-architecture.md)
- [Agent harness](docs/harness/agent-harness.md)
- [Runtime evidence workflow](docs/harness/runtime-evidence.md)
- [Release checklist](docs/operations/release-checklist.md)

## Acknowledgements

Better Lyrics Bar is a fork of [fikrilal/gnome-lyricbar](https://github.com/fikrilal/gnome-lyricbar) with word-by-word sync, Musixmatch integration, auto-width indicator, details popup menu, and extensive enhancements.

## License

MIT
