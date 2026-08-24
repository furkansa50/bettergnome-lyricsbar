/**
 * Pure-domain TTML parser.
 *
 * Better Lyrics API returns Apple-Music-flavoured TTML with word-level
 * timing (`itunes:timing="Word"`).  Each `<p>` element is a lyric line
 * and may contain `<span begin="..." end="...">word</span>` children.
 *
 * Because GJS does not expose a DOM parser we rely on lightweight regex
 * extraction.  The shapes returned here are consumed by the display
 * layer and never import GNOME/GJS APIs (domain-layer rule).
 *
 * @import { LyricLine } from './types.js'
 *
 * @typedef {Readonly<{
 *   beginMs: number,
 *   endMs: number,
 *   text: string,
 * }>} WordTiming
 *
 * @typedef {Readonly<{
 *   timeMs: number,
 *   endMs: number,
 *   text: string,
 *   words: readonly WordTiming[],
 * }>} WordTimedLyricLine
 */

/** Matches each `<p ...>...</p>` element (non-greedy, single-line aware). */
const P_PATTERN = /<p\s[^>]*?begin="([^"]+)"[^>]*?end="([^"]+)"[^>]*?>([\s\S]*?)<\/p>/g;

/** Matches each `<span ...>...</span>` word element inside a `<p>`. */
const SPAN_PATTERN = /<span\s[^>]*?begin="([^"]+)"[^>]*?end="([^"]+)"[^>]*?>([\s\S]*?)<\/span>/g;

/**
 * Parse a TTML string into an array of {@link WordTimedLyricLine}.
 *
 * @param {string} input  Raw TTML XML string.
 * @returns {WordTimedLyricLine[]}
 */
export function parseTtml(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return [];
  }

  /** @type {WordTimedLyricLine[]} */
  const lines = [];

  for (const pMatch of input.matchAll(P_PATTERN)) {
    const beginMs = parseTimestamp(pMatch[1]);
    const endMs = parseTimestamp(pMatch[2]);
    const innerHtml = pMatch[3] ?? '';

    if (beginMs === null || endMs === null) {
      continue;
    }

    /** @type {WordTiming[]} */
    const words = [];
    for (const spanMatch of innerHtml.matchAll(SPAN_PATTERN)) {
      const wBegin = parseTimestamp(spanMatch[1]);
      const wEnd = parseTimestamp(spanMatch[2]);
      const wText = stripTags(spanMatch[3] ?? '');
      if (wBegin !== null && wEnd !== null && wText !== '') {
        words.push(Object.freeze({ beginMs: wBegin, endMs: wEnd, text: wText }));
      }
    }

    // Build the full line text from words (preserving spacing) or fall back
    // to stripping tags from the inner HTML.
    const text =
      words.length > 0 ? words.map((w) => w.text).join(' ') : stripTags(innerHtml).trim();

    if (text === '') {
      continue;
    }

    lines.push(
      Object.freeze({
        timeMs: beginMs,
        endMs,
        text,
        words: Object.freeze(words),
      }),
    );
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Convert a {@link WordTimedLyricLine} array to the simpler {@link LyricLine}
 * shape expected by the existing synced-position machinery.
 *
 * @param {readonly WordTimedLyricLine[]} wordLines
 * @returns {LyricLine[]}
 */
export function wordLinesToLyricLines(wordLines) {
  return wordLines.map((wl) => ({ timeMs: wl.timeMs, text: wl.text }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a TTML timestamp string into milliseconds.
 *
 * Supports:
 *   - seconds with decimal: `"27.395"` → 27395
 *   - HH:MM:SS.mmm:          `"0:01:27.395"` → 87395
 *   - MM:SS.mmm (body dur):  `"3:21.570"` → 201570
 *
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();
  const colonParts = trimmed.split(':');

  const part0 = colonParts[0];
  const part1 = colonParts[1];
  const part2 = colonParts[2];

  if (colonParts.length === 1 && part0 !== undefined) {
    // Plain seconds (e.g. "27.395")
    return secondsToMs(part0);
  }

  if (colonParts.length === 2 && part0 !== undefined && part1 !== undefined) {
    // MM:SS.mmm
    const minutes = Number.parseInt(part0, 10);
    const secs = secondsToMs(part1);
    if (!Number.isFinite(minutes) || secs === null) {
      return null;
    }
    return minutes * 60_000 + secs;
  }

  if (
    colonParts.length === 3 &&
    part0 !== undefined &&
    part1 !== undefined &&
    part2 !== undefined
  ) {
    // HH:MM:SS.mmm
    const hours = Number.parseInt(part0, 10);
    const minutes = Number.parseInt(part1, 10);
    const secs = secondsToMs(part2);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || secs === null) {
      return null;
    }
    return hours * 3_600_000 + minutes * 60_000 + secs;
  }

  return null;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function secondsToMs(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 1000);
}

/**
 * Strip XML/HTML tags from a string and decode XML character references.
 *
 * TTML payloads escape lyric punctuation (`&#39;`, `&amp;`, `&quot;`), so the
 * raw text must be decoded here. Leaving it encoded is visible to the user:
 * the display layer escapes text again for Pango markup, which would turn
 * `&#39;` into a literal `&#39;` on screen instead of an apostrophe.
 *
 * @param {string} value
 * @returns {string}
 */
function stripTags(value) {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, '')).trim();
}

/** Named XML entities that may appear in TTML lyric text. */
const NAMED_ENTITIES = Object.freeze({
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
});

/**
 * Decode XML character references and the named entities allowed in TTML.
 *
 * `&amp;` is decoded last so that double-encoded input (`&amp;#39;`) resolves
 * to `&#39;` rather than collapsing straight to `'`.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeXmlEntities(value) {
  if (!value.includes('&')) {
    return value;
  }

  return value
    .replace(/&#(\d+);/g, (match, digits) => codePointToString(Number.parseInt(digits, 10), match))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) =>
      codePointToString(Number.parseInt(hex, 16), match),
    )
    .replace(/&(quot|apos|lt|gt|nbsp);/g, (match, name) => {
      const replacement = Reflect.get(NAMED_ENTITIES, String(name));
      return typeof replacement === 'string' ? replacement : match;
    })
    .replaceAll('&amp;', '&');
}

/**
 * @param {number} codePoint
 * @param {string} fallback Original reference, returned when out of range.
 * @returns {string}
 */
function codePointToString(codePoint, fallback) {
  if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff) {
    return fallback;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}
