# Plan: Better Lyrics Sıralama Düzeltmesi + Dynamic Music Pill Tarzı Şarkı Ayrıntıları Popup'ı

Date: 2026-07-12
Owner: Antigravity
Status: completed
Risk class: medium
Related issue/PR: N/A

## Objective

1. Söz kaynağı sıralamasını **Better Lyrics → Unison → LRCLIB** olarak değiştirmek.
   - Better Lyrics API artık cache'te olmayan sorgular için `X-API-Key` header'ı gerektiriyor (401).
   - Unison (`unison.boidu.dev`) aynı ekibe ait, sıklıkla 404 ama bazen tutturabiliyor — kullanıcı isteğiyle ekstra fallback olarak korunuyor.
   - LRCLIB tamamen API key'siz ve en sağlam kaynak.
2. MPRIS altyapısına **album art (artUrl)** ve **playback control** (PlayPause/Next/Previous/SetPosition) desteği eklemek.
3. Dynamic Music Pill tarzı popup: panele tıklayınca **album kapağı + başlık/sanatçı + ilerleme çubuğu + oynatma kontrolleri + tam sözler** göstermek.

## Constraints

- Domain katmanı (`src/domain/`) GNOME/GJS/D-Bus import etmeyecek — sadece `artUrl` alanı eklenecek.
- Tüm yeni D-Bus çağrıları ve UI sinyalleri `disable()`'da temizlenir.
- Async callback'ler `this.#enabled` guard'lı.
- Popup mevcut `PopupMenu` altyapısını kullanır (yeni pencere açmaz).

## Acceptance Criteria

1. `BetterLyricsProvider.lookup()` sırası: Better Lyrics → Unison → LRCLIB (auto modda).
2. Better Lyrics 401 yanıtları `not-found` olarak ele alınır, Unison'a düşer.
3. `PlayerSnapshot`'a `artUrl: string | null` alanı eklidir, MPRIS `mpris:artUrl` metadata'sından okunur.
4. `PlayerProxy` ve `StablePlayerProxy`'de `playPause()`, `next()`, `previous()`, `setPosition()` metodları vardır.
5. Panele tıklayınca popup açılır: album art, başlık/sanatçı, progress bar, kontrol butonları, tam sözler.
6. `npm run verify` temiz geçer.

---

## Implementation Progress

### ✅ Bölüm 1 — Söz kaynağı sıralaması: Better Lyrics → Unison → LRCLIB

**Dosyalar değişti:**

- `src/runtime/lyrics/better-lyrics.js`:
  - `lookup()` artık önce `#lookupBetterLyrics` çağırır.
  - `#lookupBetterLyrics` → miss olursa `#lookupUnison` → miss olursa `#fallbackToLrclib`.
  - `source === 'better-lyrics'`: Better Lyrics → Unison (LRCLIB yok).
  - `source === 'lrclib'`: sadece LRCLIB.
  - `source === 'auto'`: Better Lyrics → Unison → LRCLIB.
  - 401 yanıtları `not-found` olarak ele alınıp Unison'a düşer.
- `tests/lyrics/better-lyrics.test.js`: test sıralaması güncellendi.
- `prefs.js`: lyrics-source ComboRow açıklaması güncellendi.

**Test:** `tests/lyrics/better-lyrics.test.js` (3 tests passed).

### ✅ Bölüm 2 — MPRIS artUrl altyapısı + Control metodları

**Dosyalar değişti:**

- `src/domain/mpris/types.js`: `PlayerSnapshot`'a `artUrl: string | null` eklendi.
- `src/domain/mpris/normalize.js`: `RawSnapshot` and `normalizePlayerSnapshot`'a `artUrl` eklendi.
- `src/runtime/mpris/player-mapping.js`:
  - `KEY_ART_URL = 'mpris:artUrl'` eklendi.
  - `readMetadata()` ve `readArtUrl()` ile artUrl okunuyor.
  - `mapMprisProperties` ve `applyPropertyChanges`'e artUrl eklendi.
  - `snapshotsEqual`'a artUrl karşılaştırması eklendi.
- `src/runtime/mpris/player.js`:
  - `playPause()`, `next()`, `previous()`, `setPosition(trackId, positionMs)` eklendi.
  - `#callPlayerMethod` ve `#callPlayerMethodWithArgs` ile MPRIS Player arayüzüne tek atışlık fire-and-forget D-Bus çağrıları.
  - Hatalar sessizce loglanır, shell crash'i önlenir.
- `src/runtime/mpris/stable-player.js`:
  - `RawPlayerProxy` typedef'ine control metodları eklendi.
  - `playPause()`, `next()`, `previous()`, `setPosition()` proxy edildi.
- `tests/fixtures/mpris/*.json` (11 dosya): `expectedSnapshot`'lara `artUrl` eklendi.

**Test:** `tests/mpris/` (12 test files, 163 tests passed).

### ✅ Bölüm 3 — Şarkı ayrıntıları popup'ı

**Dosyalar değişti:**

- `src/shell/details-menu.js` (yeni): PopupMenu section builder.
  - Album art: `Gio.Icon.new_for_string(artUrl)` veya fallback ikon.
  - Başlık + sanatçı: `St.Label`.
  - Progress bar: pozisyon/süre `St.Label`.
  - Kontrol butonları: önceki / oynat-duraklat / sonraki (`St.Button`).
  - Tam sözler: kaydırılabilir `St.ScrollView`, aktif satır vurgulu.
- `src/shell/indicator.js`: `LyricBarIndicatorBase._init`'te `this.menu`'ye details bölümü.
  - Sol tık = popup açılır (PanelMenu.Button built-in menu).
  - `button-press-event` prefs davranışı kaldırıldı (prefs sadece ayarlar ikonundan).
- `src/runtime/controller.js`:
  - `#renderDetailsMenu()`: pozisyon + sözler + playback state'i popup'a aktarır.
  - Kontrol butonları `activePlayer` üzerinden MPRIS çağrısı yapar.
  - Album art: `artUrl`'den yükleme.

### ✅ Bölüm 4 — Testler & doğrulama

- Domain testleri: `artUrl` mapping doğrulanmış (fixture'lar).
- Runtime testleri: `stable-player.test.js` içine control metodlarının raw player'a delege edildiğini doğrulayan testler eklendi.
- Type check: `types/gjs.d.ts` stubs güncellendi, `npm run typecheck` temiz geçiyor.
- Lint check: `npm run lint` temiz geçiyor.
- Tüm 399 unit test `npm test` ile başarıyla geçiyor.

---

## Decision Log

- 2026-07-12: Better Lyrics API artık cache'te olmayan sorgular için `X-API-Key` gerektiriyor (401). Bu yüzden sıralama Better Lyrics → Unison → LRCLIB olarak değiştirildi. Better Lyrics popüler şarkılarda cache hit vereceği için ilk sıraya kondu.
- 2026-07-12: Unison kaldırılmadı — kullanıcı isteğiyle ekstra fallback olarak korundu.
- 2026-07-12: 401 yanıtları `not-found` olarak ele alınıyor (yeni track = cache'te yok = bulunamadı), böylece Unison/LRCLIB fallback zinciri sorunsuz çalışıyor.
- 2026-07-12: MPRIS control metodları fire-and-forget olarak implement edildi — popup butonları shell crash'ine yol açmaz.

## Verification

Bütün doğrulama adımları (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build:extension`) başarıyla tamamlandı. `dist/betterlyricsbar@furkansa50.zip` paketi sorunsuz şekilde oluşturuldu.
