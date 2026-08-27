# Privacy

Better Lyrics Bar is a local GNOME Shell extension. It does not include telemetry, analytics, tracking beacons, advertising identifiers, or account authentication.

## Data Sources

Better Lyrics Bar reads playback state exclusively from the local Linux MPRIS session bus. MPRIS data can include:

- player bus name
- playback status (Playing, Paused, Stopped)
- track title
- artist
- album
- track duration
- playback position

This data is already broadcast locally on your desktop by the active media player to desktop integrations.

## Network Requests

To look up and synchronize live lyrics, Better Lyrics Bar queries public lyrics providers based on the user's configuration:

### 1. Musixmatch Open Desktop API

- **Endpoint**: `https://apic-desktop.musixmatch.com/ws/1.1/`
- **Requests**:
  - `token.get`: Requests an anonymous session token for query signing.
  - `macro.subtitles.get`: Requests word-by-word `RichSync` timestamps and standard synced subtitles.
- **Transmitted Data**: Track title, artist name, and duration.

### 2. Better Lyrics API

- **Endpoint**: `https://lyrics.boidu.dev/`
- **Requests**: Looks up synchronized rich lyrics and TTML formats.
- **Transmitted Data**: Track title, artist name, and duration.

### 3. LRCLIB

- **Endpoint**: `https://lrclib.net/api/`
- **Requests**: Looks up line-synced `LRC` and plain text lyrics from the open database.
- **Transmitted Data**: Track title, artist name, album name, and duration.

### Data Guarantees

Better Lyrics Bar **never** sends:

- Spotify account data, credentials, cookies, or auth tokens.
- User playlists, listening histories, or profile info.
- Local usernames, hostnames, IP logs, or system identifiers.
- Screenshots, window contents, or browser tabs.

## Cache

Better Lyrics Bar caches lyric lookup results locally when `cache-enabled` is true. The cache is stored locally in the user's state directory (`~/.local/state/betterlyricsbar/`) to reduce duplicate network requests, minimize provider latency, and support offline playback for repeated tracks.

Disable the cache in Preferences if local storage of lyric text is not desired.

## Debug Logs

Debug logging is disabled by default. When enabled, Better Lyrics Bar writes diagnostic GNOME Shell log messages that can include track titles, artists, player bus names, lookup outcomes, and selected lyric lines to the system journal.

Enable debug logging only when diagnosing issues.

## Third Parties

Lyric lookup requests are sent directly from your machine to:

- **Musixmatch**: [musixmatch.com/privacy](https://www.musixmatch.com/privacy)
- **Better Lyrics**: [github.com/boidu/better-lyrics](https://github.com/boidu/better-lyrics)
- **LRCLIB**: [lrclib.net](https://lrclib.net/)

Users should review third-party policies when using the extension in environments with strict network filtering or external lookup restrictions.
