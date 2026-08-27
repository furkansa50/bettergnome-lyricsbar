# Troubleshooting

## Extension Does Not Appear

Check that the extension is installed and enabled:

```bash
gnome-extensions info betterlyricsbar@furkansa50
gnome-extensions enable betterlyricsbar@furkansa50
```

If the extension was just updated, reload only Better Lyrics Bar:

```bash
gnome-extensions disable betterlyricsbar@furkansa50
gnome-extensions enable betterlyricsbar@furkansa50
```

## Preferences Do Not Open

Run:

```bash
gnome-extensions prefs betterlyricsbar@furkansa50
```

If GNOME reports a schema error, rebuild and reinstall the bundle:

```bash
npm run build:extension
gnome-extensions install --force dist/betterlyricsbar@furkansa50.zip
```

## Wrong Player Is Selected

Better Lyrics Bar prefers currently playing players. If multiple players are playing, the `player-priority` setting decides which one wins first.

Set Spotify first:

```bash
GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/schemas" \
  gsettings set org.gnome.shell.extensions.betterlyricsbar player-priority "['spotify']"
```

Pause or close browser tabs that expose MPRIS if they should not be candidates.

## Lyrics Do Not Sync

Check that the player exposes MPRIS metadata:

```bash
busctl --user list | grep org.mpris.MediaPlayer2
```

Enable debug logging temporarily:

```bash
GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/schemas" \
  gsettings set org.gnome.shell.extensions.betterlyricsbar debug-logging true
journalctl --user -f -o short-iso _COMM=gnome-shell | grep LyricBar
```

Turn debug logging off after troubleshooting:

```bash
GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/schemas" \
  gsettings set org.gnome.shell.extensions.betterlyricsbar debug-logging false
```

## Track Has No Synced Lyrics

Some tracks do not have synced lyrics in the configured provider. Better Lyrics Bar falls back according to `fallback-mode`:

- `track`: show artist and title
- `idle`: show quiet idle text
- `hidden`: hide the indicator

You can also try switching the lyrics source in the details popup menu or Preferences (`musixmatch`, `better-lyrics`, or `lrclib`).

## Text Alignment Does Not Change

Confirm the setting changed:

```bash
GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/schemas" \
  gsettings get org.gnome.shell.extensions.betterlyricsbar text-align
```

If the value changes but the panel does not, reload Better Lyrics Bar and check GNOME Shell logs for `LyricBar settings-changed`.

## Report Runtime Evidence

Useful reports include:

- GNOME Shell version
- session type, X11 or Wayland
- player name
- track title
- `gnome-extensions info betterlyricsbar@furkansa50`
- relevant `journalctl --user _COMM=gnome-shell` lines
