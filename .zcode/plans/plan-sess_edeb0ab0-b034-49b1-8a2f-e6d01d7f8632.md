# Plan: Söz kaynaklarını sağlamlaştır + Dynamic Music Pill tarzı şarkı ayrıntıları popup'ı

## Değişen tek nokta (önceki plana göre)

**Unison KORUNUR** ama sıralama değişir. Yeni zincir:
**Better Lyrics → Unison → LRCLIB**

- Better Lyrics önce denenir (cache hit olan popüler şarkılarda çalışır).
- Better Lyrics miss/401 olursa **Unison** ekstra fallback olarak denenir (`unison.boidu.dev/lyrics`).
- Unison da bulamazsa **LRCLIB**'e (en sağlam, API key'siz) düşülür.

## Durum tespiti (araştırma bulguları)

- **Better Lyrics API**: cache'te olan şarkılar API key'siz çalışır, cache'te olmayanlar 401. Güvenilir değil ama popüler şarkılarda değerli.
- **Unison**: aynı ekip, sıklıkla 404 ama bazen tutturabiliyor — kullanıcı isteğiyle ekstra fallback olarak kalır.
- **LRCLIB**: tamamen API key'siz, en sağlam.
- PlayerSnapshot'ta `artUrl` yok. PlayerProxy'de `readPosition` var ama PlayPause/Next/Previous/SetPosition yok. Indicator `PanelMenu.Button` (built-in `this.menu` var) ve `button-press-event` prefs için kullanılıyor.

## Yapılacaklar

### Bölüm 1 — Söz kaynağı sıralaması: Better Lyrics → Unison → LRCLIB

1. **`src/runtime/lyrics/better-lyrics.js`**: `lookup()` akışını yeniden sırala:
   - Better Lyrics önce denenir.
   - Miss (404/401/not-found) olursa → Unison denenir.
   - Unison da miss olursa → LRCLIB (sadece `source === 'auto'` ise).
   - `source === 'better-lyrics'`: sadece Better Lyrics (fallback'siz).
   - `source === 'lrclib'`: sadece LRCLIB.
   - `#parseUnisonResponse` ve `#parseBetterLyricsResponse` korunur; sadece çağırma sırası değişir.
2. **401 (API key gerekli) durumu**: `not-found`/error olarak ele alınıp Unison'a düşer (mevcut `< 200 || >= 300` dalı + 401 özel durumu).
3. **prefs.js**: lyrics-source ComboRow açıklaması netleştirilir (sıralama belirtilir).

### Bölüm 2 — MPRIS control & artUrl altyapısı (popup için)

4. **PlayerSnapshot'a `artUrl`** (`src/domain/mpris/types.js`): `artUrl: string | null`.
5. **player-mapping.js**: `mpris:artUrl` oku, mapping + `snapshotsEqual`'a ekle.
6. **PlayerProxy'ye control metodları** (`src/runtime/mpris/player.js`): `playPause()`, `next()`, `previous()`, `setPosition(trackId, positionUs)` — `org.mpris.MediaPlayer2.Player` üzerinden tek atışlık `connection.call`, enabled guard'lı.
7. **StablePlayerProxy** bu metodları proxy eder.

### Bölüm 3 — Şarkı ayrıntıları popup'ı (Dynamic Music Pill tarzı)

8. **Yeni `src/shell/details-menu.js`**: Indicator'ın `this.menu`'süne (PopupMenu) bölüm ekleyen builder:
   - Album kapağı (`Gio.Icon.new_for_string(artUrl)`; olmazsa `audio-x-generic-symbolic`).
   - Başlık + sanatçı (`St.Label`).
   - Progress bar + pozisyon/süre (mevcut 500ms poll değerleri).
   - Kontrol butonları: önceki / oynat-duraklat / sonraki (MPRIS control metodlarına bağlı).
   - Sözlerin tamamı: kaydırılabilir `St.ScrollView`, aktif satır vurgulu (`currentLookup.lines`).
9. **Indicator entegrasyonu** (`src/shell/indicator.js`): sol tık = popup, prefs ayarlar ikonundan. `button-press-event` prefs davranışı kaldırılır/ayarlanır.
10. **Controller**: `#renderDetailsMenu()` pozisyon + sözler + playback state'i popup'a aktarır; kontrol butonları MPRIS çağrısı yapar.

### Bölüm 4 — Testler & doğrulama

11. Domain testleri: `artUrl` mapping (`tests/mpris/`).
12. Runtime testleri: control metodları mock D-Bus.
13. `better-lyrics.test.js`: yeni sıralama (Better Lyrics → Unison → LRCLIB).
14. **`npm run verify`** tam geçmeli.
15. Execution plan güncellenir.

## Mimari kararlar & kısıtlar

- Domain katmanı GNOME/GJS/D-Bus import etmez — sadece `artUrl` field.
- Tüm yeni D-Bus çağrıları ve UI sinyalleri `disable()`'da temizlenir.
- Async callback'ler `this.#enabled` guard'lı.
- Popup mevcut `PopupMenu` altyapısını kullanır (yeni pencere açmaz).

## Riskler

- Album art URL'leri (`file://`/`https://`) için `Gio.Icon` yetmezse fallback ikon.
- MPRIS control metodları bazı oynatıcılarda yok olabilir — hatalar loglanır, sessizce yutulur.

## Çıktı

- Söz zinciri: **Better Lyrics → Unison → LRCLIB**.
- Panele tıklayınca album kapağı + başlık/sanatçı + progress + kontroller + tam sözler açılır.
- `npm run verify` temiz geçer.
