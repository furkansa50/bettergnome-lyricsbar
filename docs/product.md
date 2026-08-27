# Better Lyrics Bar Product Overview

Better Lyrics Bar is a GNOME Shell extension that displays real-time synchronized live lyrics for the active music player directly in the GNOME top bar.

The product is built for people who listen to music while working and want glanceable lyrics without switching windows, opening a separate lyrics site, or keeping the player window visible. Better Lyrics Bar treats lyrics as ambient desktop context: present when useful, quiet when unavailable, and never disruptive to the user’s workflow.

## Problem

Desktop music players expose playback state through the Linux MPRIS interface, but they generally do not expose synchronized lyrics to the desktop shell. Users who want live lyrics usually need to keep a player window open, use a browser extension, or rely on a separate floating application.

That creates friction for a simple use case: seeing the current lyric line in sync while continuing to work.

## Product

Better Lyrics Bar adds a compact, auto-sizing lyric display to the GNOME top bar. It watches MPRIS-compatible media players, identifies the active track, queries a multi-tier lyrics pipeline, and updates the top-bar text as playback progresses.

### Key Capabilities

1. **Word-by-Word Live Synchronization**: Delivers real-time syllable and word timing with smooth transitions and glowing highlight effects.
2. **Multi-Tier Provider Pipeline**:
   - **Musixmatch Open Desktop API**: Highest precision word-timing data via RichSync and LRC formats.
   - **Better Lyrics API**: Community-curated synced lyrics in RichSync and TTML format.
   - **LRCLIB**: Fast, keyless open-source fallback for line-synced and plain text lyrics.
3. **Dynamic Auto-Width**: The top-bar indicator smoothly resizes to fit current lyrics without clipping or layout jitter.
4. **Interactive Details Popup**: Clicking the top-bar indicator reveals album artwork, artist/album metadata, playback controls (Play/Pause, Next, Previous), seek bar, volume control, and active lyrics source switcher.
5. **Graceful Fallback**: When synced lyrics are unavailable across providers, it falls back cleanly (show track, idle message, or hide) based on preferences.

## Target Users

- GNOME users who listen to music while working.
- Spotify Desktop and browser player users who want live lyrics outside the player window.
- Linux desktop users who prefer native shell integration over floating widgets.
- Developers and power users who care about privacy, reliability, and predictable desktop behavior.

## Core Experience

The primary experience is glanceable and ambient:

1. Start playing music in Spotify or any MPRIS-compatible player.
2. Better Lyrics Bar appears in the GNOME top bar.
3. Word-by-word or line-by-line lyrics update in real-time sync with playback.
4. If lyrics are unavailable, it falls back to track metadata or a quiet idle state.
5. Click the indicator anytime for quick controls, track info, or provider switching.

## Product Principles

### Reliable Inside GNOME Shell

GNOME Shell extensions run inside the desktop shell process. Better Lyrics Bar must be defensive by design: lifecycle cleanup, guarded async callbacks, bounded timers, explicit error handling, and no unsafe assumptions about D-Bus names or player behavior.

### Glanceable, Not Distracting

The top bar has limited space. Better Lyrics Bar adapts its width cleanly, respects maximum width boundaries, uses ellipsis when necessary, and maintains predictable desktop layout behavior.

### Privacy-Aware

Lyric lookup sends only public track metadata (title, artist, album, duration) to public lyrics providers. Better Lyrics Bar does not collect telemetry, access private player accounts, or inspect private user data.

### Native Linux Integration

Better Lyrics Bar uses MPRIS and GNOME platform APIs directly. It does not scrape Spotify, automate browser windows, or depend on fragile UI inspection.

### Multi-Provider Resilience

Missing lyrics, rate limits, or network failures in any single provider automatically trigger the next provider in the chain (Musixmatch ➔ Better Lyrics ➔ LRCLIB).

## V1 Scope

The v1.0.0 release delivers:

- Active MPRIS player detection and prioritization.
- Multi-tier lyrics retrieval: Musixmatch (RichSync/LRC), Better Lyrics API (RichSync/TTML), and LRCLIB.
- Real-time word-by-word synced display with CSS glow animations.
- Dynamic auto-width top-bar label.
- Top-bar song details popup menu with playback controls and source selection.
- Local lyric caching for fast repeat lookups.
- Full preferences UI (position, alignment, styling presets, custom HEX color picker, glow strength, cache).
- GNOME Shell 46, 47, 48, 49, and 50 compatibility.

## Success Criteria

Better Lyrics Bar is successful when it runs reliably as a daily-use GNOME extension without destabilizing the desktop:

- Survives enable, disable, logout, login, player launch, player quit, and track changes without leaks.
- Word and line lyrics remain tightly synchronized with playback.
- Gracefully degrades when lyrics are absent or offline.
- Tested and verified across multiple desktop distributions and MPRIS players.
