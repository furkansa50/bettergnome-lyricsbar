import { describe, expect, it } from 'vitest';

import { parseTtml, wordLinesToLyricLines } from '../../src/domain/lyrics/ttml.js';

const sampleTtml = `
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
  <body>
    <div>
      <p begin="27.395" end="28.960">
        <span begin="27.395" end="27.549">I</span>
        <span begin="27.549" end="27.740">been</span>
        <span begin="27.740" end="28.077">tryna</span>
        <span begin="28.077" end="28.960">call</span>
      </p>
      <p begin="30.180" end="32.520">
        No spans here
      </p>
    </div>
  </body>
</tt>
`;

describe('parseTtml', () => {
  it('parses timed lines and spans correctly', () => {
    const result = parseTtml(sampleTtml);

    expect(result).toHaveLength(2);

    // Line 1 with word timing
    expect(result[0]).toEqual({
      timeMs: 27395,
      endMs: 28960,
      text: 'I been tryna call',
      words: [
        { beginMs: 27395, endMs: 27549, text: 'I', trailingSpace: true },
        { beginMs: 27549, endMs: 27740, text: 'been', trailingSpace: true },
        { beginMs: 27740, endMs: 28077, text: 'tryna', trailingSpace: true },
        { beginMs: 28077, endMs: 28960, text: 'call', trailingSpace: false },
      ],
    });

    // Line 2 without word timing (fallback to plain text)
    expect(result[1]).toEqual({
      timeMs: 30180,
      endMs: 32520,
      text: 'No spans here',
      words: [],
    });
  });

  it('correctly maps to simpler lyric lines', () => {
    const result = parseTtml(sampleTtml);
    const simpler = wordLinesToLyricLines(result);

    expect(simpler).toEqual([
      { timeMs: 27395, text: 'I been tryna call' },
      { timeMs: 30180, text: 'No spans here' },
    ]);
  });

  it('decodes XML character references in words and lines', () => {
    const ttml = `
      <p begin="1.000" end="2.000">
        <span begin="1.000" end="1.500">don&#39;t</span>
        <span begin="1.500" end="2.000">me &amp; you</span>
      </p>
      <p begin="3.000" end="4.000">&quot;Hello&quot; &#x2014; it&apos;s me</p>
    `;

    const result = parseTtml(ttml);

    expect(result[0]?.words.map((word) => word.text)).toEqual(["don't", 'me & you']);
    expect(result[0]?.text).toBe("don't me & you");
    expect(result[1]?.text).toBe('"Hello" — it\'s me');
  });

  it('decodes &amp; last so double-encoded references survive one pass', () => {
    const result = parseTtml('<p begin="1.000" end="2.000">a&amp;#39;b</p>');

    expect(result[0]?.text).toBe('a&#39;b');
  });

  it('leaves out-of-range character references untouched', () => {
    const result = parseTtml('<p begin="1.000" end="2.000">&#0; &#1114112;</p>');

    expect(result[0]?.text).toBe('&#0; &#1114112;');
  });

  it('preserves syllable-level words without inserting extra spaces', () => {
    const ttml = `
      <p begin="64.132" end="70.990">
        <span begin="64.132" end="64.582">Be</span><span begin="64.582" end="65.032">cause</span> <span begin="65.032" end="65.759">love</span> <span begin="66.960" end="67.259">can</span> <span begin="67.259" end="68.748">burn</span> <span begin="68.748" end="69.131">like</span> <span begin="69.131" end="69.549">a</span> <span begin="69.549" end="70.179">ci</span><span begin="70.179" end="70.486">ga</span><span begin="70.486" end="70.990">rette</span>
      </p>
    `;

    const result = parseTtml(ttml);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Because love can burn like a cigarette');
    expect(result[0]?.words.map((w) => [w.text, w.trailingSpace])).toEqual([
      ['Be', false],
      ['cause', true],
      ['love', true],
      ['can', true],
      ['burn', true],
      ['like', true],
      ['a', true],
      ['ci', false],
      ['ga', false],
      ['rette', false],
    ]);
  });
});
