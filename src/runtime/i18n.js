/**
 * Returns either Turkish or English string depending on the user's system locale.
 *
 * @param {string} en  English string
 * @param {string} tr  Turkish string
 * @returns {string}
 */
export function _t(en, tr) {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    if (typeof locale === 'string' && locale.toLowerCase().startsWith('tr')) {
      return tr;
    }
  } catch {
    // Ignore Intl errors
  }

  try {
    /* eslint-disable dot-notation */
    const envLang =
      (typeof process !== 'undefined' &&
        (process.env?.['LC_ALL'] || process.env?.['LC_MESSAGES'] || process.env?.['LANG'])) ||
      '';
    /* eslint-enable dot-notation */
    if (typeof envLang === 'string' && envLang.toLowerCase().startsWith('tr')) {
      return tr;
    }
  } catch {
    // Ignore env errors
  }

  return en;
}
