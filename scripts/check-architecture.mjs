/**
 * @typedef {Readonly<{
 *   acquirePattern: RegExp,
 *   releasePattern: RegExp,
 *   acquireLabel: string,
 *   releaseLabel: string,
 * }>} CleanupRule
 */

import { listFiles, readText } from './lib/repo.mjs';

/** @type {string[]} */
const failures = [];
const sourceFiles = (await listFiles('.')).filter(
  (path) => (path.endsWith('.js') || path.endsWith('.mjs')) && !path.startsWith('node_modules/'),
);

for (const path of sourceFiles) {
  const content = await readText(path);

  checkNoRawControlCharacters(path, content);

  if (path.startsWith('src/domain/')) {
    checkForbidden(path, content, /gi:\/\//, 'domain modules must not import GJS GI modules');
    checkForbidden(
      path,
      content,
      /resource:\/\/\/org\/gnome/,
      'domain modules must not import GNOME Shell resources',
    );
    checkForbidden(
      path,
      content,
      /\b(Gio|GLib|St|Clutter|PanelMenu|PopupMenu)\b/,
      'domain modules must stay platform-free',
    );
    checkForbidden(
      path,
      content,
      /\b(fetch|XMLHttpRequest)\b/,
      'domain modules must not perform network I/O',
    );
    checkForbidden(path, content, /node:/, 'domain modules must not import Node.js modules');
  }

  if (path.startsWith('src/shell/') || path === 'extension.js' || path === 'prefs.js') {
    checkRequiredCleanup(path, content, {
      acquirePattern: /\.connect\s*\(/,
      releasePattern: /\.disconnect\s*\(/,
      acquireLabel: 'connect(...)',
      releaseLabel: 'disconnect(...)',
    });
    checkRequiredCleanup(path, content, {
      acquirePattern: /\bGLib\.timeout_add(?:_seconds)?\s*\(/,
      releasePattern: /\bGLib\.source_remove\s*\(/,
      acquireLabel: 'GLib timeout',
      releaseLabel: 'GLib.source_remove(...)',
    });
    checkRequiredCleanup(path, content, {
      acquirePattern: /\bGio\.bus_watch_name\s*\(/,
      releasePattern: /\bGio\.bus_unwatch_name\s*\(/,
      acquireLabel: 'Gio.bus_watch_name(...)',
      releaseLabel: 'Gio.bus_unwatch_name(...)',
    });
    checkRequiredCleanup(path, content, {
      acquirePattern: /\bGio\.Cancellable\b/,
      releasePattern: /\.cancel\s*\(/,
      acquireLabel: 'Gio.Cancellable',
      releaseLabel: 'cancel(...)',
    });
  }

  if (path.startsWith('src/runtime/')) {
    checkRequiredCleanup(path, content, {
      acquirePattern: /\.connect\s*\(/,
      releasePattern: /\.disconnect\s*\(|\blifecycle\.\w+\s*\(/,
      acquireLabel: 'connect(...)',
      releaseLabel: 'disconnect(...) or lifecycle.<method>(...)',
    });
    checkRequiredCleanup(path, content, {
      acquirePattern: /\bGio\.Cancellable\b/,
      releasePattern: /\.cancel\s*\(|\blifecycle\.\w+\s*\(/,
      acquireLabel: 'Gio.Cancellable',
      releaseLabel: 'cancel(...) or lifecycle.<method>(...)',
    });
  }

  if (isRuntimeSource(path)) {
    checkForbidden(
      path,
      content,
      /bus_watch_name\s*\([\s\S]*?['"][^'"]*\*[^'"]*['"]/,
      'Gio.bus_watch_name must not be used with wildcard D-Bus names',
    );
  }

  if (!path.startsWith('tests/') && !path.startsWith('scripts/')) {
    checkForbidden(
      path,
      content,
      /\bconsole\.log\s*\(/,
      'production source must not use console.log',
    );
  }
}

/**
 * @param {string} path
 * @param {string} content
 * @param {RegExp} pattern
 * @param {string} message
 * @returns {void}
 */
function checkForbidden(path, content, pattern, message) {
  if (!pattern.test(content)) {
    return;
  }

  failures.push(`${path}: ${message}`);
}

/**
 * Rejects raw control characters and invisible line separators in source text.
 *
 * These bytes are invisible in editors and pass ESLint, Prettier, `tsc`, and
 * Node's parser, but GJS/SpiderMonkey stops reading a script at a literal NUL
 * and fails extension load with a misleading
 * `'' literal not terminated before end of script` SyntaxError. U+2028 and
 * U+2029 are line terminators outside string literals, so they can silently
 * split statements.
 *
 * Escape sequences such as `\u0000` are unaffected; only raw bytes are rejected.
 *
 * @param {string} path
 * @param {string} content
 * @returns {void}
 */
function checkNoRawControlCharacters(path, content) {
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < content.length; index += 1) {
    const codePoint = content.charCodeAt(index);

    if (codePoint === 0x0a) {
      line += 1;
      lineStart = index + 1;
      continue;
    }

    if (!isForbiddenCodePoint(codePoint)) {
      continue;
    }

    const column = index - lineStart + 1;
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    failures.push(
      `${path}:${line}:${column}: raw control character ${label} is not allowed in source; use an escape sequence instead`,
    );
  }
}

/**
 * Tab, line feed, and carriage return are the only control characters allowed in
 * source text.
 *
 * @param {number} codePoint
 * @returns {boolean}
 */
function isForbiddenCodePoint(codePoint) {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
    return false;
  }

  // C0 controls, DEL, and the invisible Unicode line/paragraph separators.
  return codePoint < 0x20 || codePoint === 0x7f || codePoint === 0x2028 || codePoint === 0x2029;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isRuntimeSource(path) {
  return path === 'extension.js' || path === 'prefs.js' || path.startsWith('src/');
}

/**
 * @param {string} path
 * @param {string} content
 * @param {CleanupRule} rule
 * @returns {void}
 */
function checkRequiredCleanup(path, content, rule) {
  if (!rule.acquirePattern.test(content)) {
    return;
  }

  if (rule.releasePattern.test(content)) {
    return;
  }

  failures.push(`${path}: ${rule.acquireLabel} requires tracked cleanup via ${rule.releaseLabel}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Architecture guardrails passed.\n');
