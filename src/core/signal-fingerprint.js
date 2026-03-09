const crypto = require('crypto');

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.toLowerCase());
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return url.toLowerCase().replace(/\/+$/, ''); }
}

function computeFingerprint(signal) {
  const url = normalizeUrl(signal.sourceUrl || '');
  let input;
  if (url) {
    input = url;
  } else {
    const title = (signal.rawTitle || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').slice(0, 80);
    const text = (signal.rawText || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').slice(0, 200);
    input = (signal.sourceType || '') + ':' + title + ':' + text;
  }
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

module.exports = { computeFingerprint };
