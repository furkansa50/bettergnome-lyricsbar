# Plan: Better Lyrics Sıralama Düzeltmesi + Dynamic Music Pill Tarzı Şarkı Ayrıntıları Popup'ı

Date: 2026-07-12
Owner: Antigravity
Status: completed
Risk class: medium
Related issue/PR: N/A

> **2026-08-24 düzeltmesi:** Bu plan ilk yazıldığında söz kaynağı sıralamasını
> `Better Lyrics → Unison → LRCLIB` olarak tarif ediyordu, ancak kodda hiçbir zaman
> öyle uygulanmadı ve kullanıcı mevcut `Unison → Better Lyrics → LRCLIB` sırasının
> korunmasına karar verdi. Yanlış olan plan metniydi, kod değil. Aşağıdaki bölümler
> koddaki gerçek davranışa göre düzeltildi; ayrıca "Verification" bölümündeki
> doğrulanamamış iddialar gerçek durumla değiştirildi.

## Objective

1. Söz kaynağı zincirini **Unison → Better Lyrics → LRCLIB** olarak netleştirmek.
   - Unison (`unison.boidu.dev`) API key'siz çalışıyor ve TTML kelime zamanlaması
     döndürebiliyor, bu yüzden zincirin başında duruyor.
   - Better Lyrics API cache'te olmayan sorgular için `X-API-Key` header'ı gerektiriyor
     (401); bu yanıtlar `not-found` olarak ele alınıp zincir devam ediyor.
   - LRCLIB tamamen API key'siz ve en sağlam kaynak, son fallback.
2. MPRIS altyapısına **album art (artUrl)** ve **playback control** (PlayPause/Next/Previous/SetPosition) desteği eklemek.
3. Dynamic Music Pill tarzı popup: panele tıklayınca **album kapağı + başlık/sanatçı + ilerleme çubuğu + oynatma kontrolleri + tam sözler** göstermek.

## Constraints

- Domain katmanı (`src/domain/`) GNOME/GJS/D-Bus import etmeyecek — sadece `artUrl` alanı eklenecek.
- Tüm yeni D-Bus çağrıları ve UI sinyalleri `disable()`'da temizlenir.
- Async callback'ler `this.#enabled` guard'lı.
- Popup mevcut `PopupMenu` altyapısını kullanır (yeni pencere açmaz).

## Acceptance Criteria

1. `BetterLyricsProvider.lookup()` sırası: Unison → Better Lyrics → LRCLIB (auto modda).
2. Better Lyrics 401 yanıtları `not-found` olarak ele alınır, zincir LRCLIB'e düşer.
3. `PlayerSnapshot`'a `artUrl: string | null` alanı eklidir, MPRIS `mpris:artUrl` metadata'sından okunur.
4. `PlayerProxy` ve `StablePlayerProxy`'de `playPause()`, `next()`, `previous()`, `setPosition()` metodları vardır.
5. Panele tıklayınca popup açılır: album art, başlık/sanatçı, progress bar, kontrol butonları, tam sözler.
6. `npm run verify` temiz geçer.

---

## Implementation Progress

### ✅ Bölüm 1 — Söz kaynağı zinciri: Unison → Better Lyrics → LRCLIB

**Dosyalar değişti:**

- `src/runtime/lyrics/better-lyrics.js`:
  - `lookup()` önce `#lookupUnison` çağırır.
  - `#lookupUnison` → miss olursa `#lookupBetterLyrics` → miss olursa `#fallbackToLrclib`.
  - `source === 'better-lyrics'`: Unison → Better Lyrics (LRCLIB yok).
  - `source === 'lrclib'`: sadece LRCLIB.
  - `source === 'auto'`: Unison → Better Lyrics → LRCLIB.
  - 401 yanıtları `not-found` olarak ele alınıp zincir devam eder.
  - Unison yanıtı önce TTML olarak, olmazsa LRC olarak ayrıştırılır; ikisi de
    zamanlama veremezse zincir devam eder.
  - Unison metadata döndürmediği için `track` alanı sorgudan (`title`/`artist`/
    `album`/`durationMs`) kurulur — `durationMs` null kalırsa sync politikaları
    pozisyonu reddediyordu.
- `tests/lyrics/better-lyrics.test.js`: zincir sırası + Unison yanıt ayrıştırma testleri.
- `prefs.js`: lyrics-source ComboRow açıklaması güncellendi.

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
  - `SetPosition` imzası `(o, x)` — trackId object path olarak, pozisyon mikrosaniye
    olarak gönderilir; trackId yoksa çağrı hiç yapılmaz.
  - Hatalar sessizce loglanır, shell crash'i önlenir.
- `src/runtime/mpris/stable-player.js`:
  - `RawPlayerProxy` typedef'ine control metodları eklendi.
  - `playPause()`, `next()`, `previous()`, `setPosition()` proxy edildi.
- `tests/fixtures/mpris/*.json` (11 dosya): `expectedSnapshot`'lara `artUrl` eklendi.

### ✅ Bölüm 3 — Şarkı ayrıntıları popup'ı

**Dosyalar değişti:**

- `src/domain/display/track-progress.js` (yeni): progress/scroll aritmetiği
  (`formatTrackTime`, `computeProgressFraction`, `computeSeekPositionMs`,
  `computeBarFraction`, `computeScrollValue`) — platform API'si içermez.
- `src/domain/display/sync-polling.js`: `shouldPollPlayerPosition` eklendi. Popup'ın
  saati ve progress bar'ı, senkron sözü olmayan parçalarda da ilerlemek zorunda,
  bu yüzden pozisyon polling'i `shouldPollSyncedLyrics`'ten bağımsız.
- `src/domain/lyrics/lrc.js`: `selectLyricLineIndex` eklendi. Tam söz listesinde
  aktif satırı vurgulamak için metin eşleştirmesi yetmiyor — nakarat tekrarları
  aynı metne sahip olduğu için her tekrarı vurguluyordu.
- `src/shell/details-menu.js` (yeni): PopupMenu section builder.
  - Album art: `Gio.Icon.new_for_string(artUrl)` veya fallback ikon
    (`data:` URI'leri reddedilir).
  - Başlık + sanatçı: `St.Label`.
  - Progress bar: `St.BoxLayout` + tek kalıcı dolgu aktörü. St CSS yüzde birimi
    desteklemediği için dolgu genişliği bar'ın allocation'ından piksel olarak
    hesaplanır; bar'a tıklamak `SetPosition` ile seek yapar.
  - Kontrol butonları: önceki / oynat-duraklat / sonraki (`St.Button`).
  - Tam sözler: kaydırılabilir `St.ScrollView`, aktif satır vurgulu ve görünür
    sayfada ortalanır.
  - Popup kapalıyken aktörlerin allocation'ı olmadığı için dolgu genişliği ve
    scroll konumu `open-state-changed` sinyalinde yeniden uygulanır.
  - Bütün sinyaller `destroy()`'da disconnect edilir.
- `src/shell/indicator.js`: `LyricBarIndicatorBase._init`'te `this.menu`'ye details bölümü.
  - Sol tık = popup açılır (PanelMenu.Button built-in menu).
  - `button-press-event` prefs davranışı kaldırıldı (prefs sadece ayarlar ikonundan).
- `src/runtime/controller.js`:
  - `#renderDetails()`: pozisyon + sözler + playback state + artUrl'i popup'a aktarır.
  - `#pollPosition()` senkron söz olmasa da pozisyonu takip eder ve `#renderDetails()`
    çağırır, böylece progress bar akar.
  - `#invalidateStalePosition()`: parça değişince `#lastKnownPositionMs` sıfırlanır,
    yoksa yeni parça eski pozisyonla açılıyordu.
  - Kontrol butonları `activePlayer` üzerinden MPRIS çağrısı yapar; `onSeek`
    `setPosition(trackId, positionMs)`'e bağlanır.

### ✅ Bölüm 4 — Testler & doğrulama

- Domain testleri: `artUrl` mapping doğrulanmış (fixture'lar).
- Runtime testleri: `stable-player.test.js` içine control metodlarının raw player'a delege edildiğini doğrulayan testler eklendi.
- Yeni domain testleri: `tests/display/track-progress.test.js`,
  `tests/display/sync-polling.test.js` (`shouldPollPlayerPosition`),
  `tests/lyrics/lrc.test.js` (`selectLyricLineIndex`, nakarat tekrarı dahil),
  `tests/lyrics/ttml.test.js` (entity decode), `tests/lyrics/better-lyrics.test.js`
  (Unison yanıt ayrıştırma).
- Type check: `types/gjs.d.ts` stubs güncellendi.

---

## Decision Log

- 2026-07-12: Better Lyrics API artık cache'te olmayan sorgular için `X-API-Key` gerektiriyor (401). 401 yanıtları `not-found` olarak ele alınıyor (yeni track = cache'te yok = bulunamadı), böylece fallback zinciri sorunsuz çalışıyor.
- 2026-07-12: Unison kaldırılmadı — kullanıcı isteğiyle korundu.
- 2026-07-12: MPRIS control metodları fire-and-forget olarak implement edildi — popup butonları shell crash'ine yol açmaz.
- 2026-08-24: Söz kaynağı sırası **Unison → Better Lyrics → LRCLIB** olarak
  onaylandı (kullanıcı kararı). Planın ilk halindeki "Better Lyrics ilk sırada"
  ifadesi kodda hiç uygulanmamıştı; doküman koda göre düzeltildi, zincir
  değiştirilmedi.
- 2026-08-24: Progress bar dolgusu St CSS yüzdesi yerine piksel genişlikle
  çiziliyor — St, `width: 50%` gibi yüzde birimlerini desteklemiyor ve bar
  bu yüzden hiç görünmüyordu.
- 2026-08-24: Aktif satır vurgusu satır metni yerine satır indeksi ile
  yapılıyor — nakarat tekrarlarında metin eşleştirmesi birden fazla satırı
  vurguluyordu.
- 2026-08-24: Söz isteklerinin cancellable/timeout kayıtları `LifecycleRegistry`
  yerine provider içindeki bir `#inflight` set'inde tutuluyor. `LifecycleRegistry`
  kayıt silme API'si sunmadığı için her istek kalıcı olarak birikiyordu.

## Verification

Bu bölüm 2026-08-24'te düzeltildi. Planın ilk hali "bütün doğrulama adımları
başarıyla tamamlandı ve `dist/betterlyricsbar@furkansa50.zip` paketi sorunsuz
oluşturuldu" diyordu; bu iddia doğrulanabilir değildi — repoda `node_modules`
kurulu bile değildi, yani hiçbir gate çalıştırılmamıştı.

2026-08-24'te gerçekten çalıştırılan adımlar:

| Adım                 | Sonuç                               |
| -------------------- | ----------------------------------- |
| `verify:docs`        | ✅ Documentation structure is valid |
| `validate:metadata`  | ✅ metadata.json is valid           |
| `validate:schema`    | ✅ GSettings schema is valid        |
| `check:architecture` | ✅ Architecture guardrails passed   |
| `format:check`       | ✅ All matched files use Prettier   |
| `lint`               | ✅ temiz                            |
| `typecheck`          | ✅ temiz                            |
| `test`               | ✅ 39 dosya / 433 test              |
| `build:extension`    | ⚠️ bu makinede çalışmıyor           |
| `validate:bundle`    | ✅ (elle paketlenen zip ile)        |

Notlar:

- `build:extension` bu makinede **çalıştırılamıyor**: `zip` komutu kurulu değil ve
  script "zip is required to build the extension bundle." hatasıyla duruyor.
  `glib-compile-schemas` dahil öncesindeki bütün adımlar başarılı — yalnızca son
  arşivleme adımı düşüyor. `dist/<uuid>/` staging dizini doğru üretiliyor.
- `validate:bundle`'ı doğrulamak için zip, staging dizininden Python `zipfile` ile
  elle üretildi; `validate:bundle` temiz geçti ve arşiv 52 dosya içeriyor
  (`schemas/gschemas.compiled` ve dört `types.js` dosyası doğru şekilde dışarıda).
  Yani paketleme sözleşmesi doğru; eksik olan tek şey `zip` binary'si.
- CI'da veya `zip` kurulu bir makinede `npm run verify` zincirinin tamamı
  çalıştırılmalı.
