const crypto = require('crypto');
const cheerio = require('cheerio');
const { BaseDiscoveryProvider } = require('./base-provider');

class XProvider extends BaseDiscoveryProvider {
  constructor(opts = {}) {
    super({ name: 'x', sourceType: 'x' });
    this.username = opts.username || '';
    this.password = opts.password || '';
    this.userAgent = opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    this._cookies = null;
  }

  async discover(query) {
    const searchQueries = this._buildSearchQueries(query);
    const results = [];

    for (const sq of searchQueries) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, 'Accept': 'text/html' }
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        const $ = cheerio.load(html);
        $('.result').each((i, el) => {
          const $el = $(el);
          const title = $el.find('.result__title .result__a').text().trim();
          const snippet = $el.find('.result__snippet').text().trim();
          let resultUrl = $el.find('.result__title .result__a').attr('href') || '';
          if (resultUrl.includes('uddg=')) {
            try { resultUrl = decodeURIComponent(resultUrl.split('uddg=')[1].split('&')[0]); } catch {}
          }
          if (title && (resultUrl.includes('x.com') || resultUrl.includes('twitter.com'))) {
            results.push({ title, snippet, url: resultUrl });
          }
        });
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[XProvider] Error:`, err.message);
      }
    }

    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }

  _buildSearchQueries(query) {
    const base = query || 'automation tool';
    return [
      `site:x.com "${base}" "I hate" OR "need a tool" OR "looking for"`,
      `site:x.com "${base}" automation OR workflow OR "better way"`,
      `site:twitter.com "${base}" "anyone know" OR "struggling with"`
    ];
  }

  normalizeSignal(raw) {
    return {
      id: 'sig-' + crypto.randomBytes(4).toString('hex'),
      sourceType: 'x',
      sourceName: 'X/Twitter',
      sourceUrl: raw.url || '',
      authorHandle: this._extractHandle(raw.url),
      capturedAt: new Date().toISOString(),
      rawTitle: raw.title || '',
      rawText: raw.snippet || '',
      extractedPain: '',
      extractedDesire: '',
      extractedUseCase: this._extractUseCase(raw.title + ' ' + raw.snippet),
      engagement: { score: 0, comments: 0, likes: 0, shares: 0 },
      relevanceScore: 0.5
    };
  }

  _extractHandle(url) {
    try {
      const m = url.match(/(?:x\.com|twitter\.com)\/([^/]+)/);
      return m ? '@' + m[1] : '';
    } catch { return ''; }
  }

  _extractUseCase(text) {
    const patterns = [/automate (.{10,80})/i, /tool for (.{10,80})/i,
      /better way to (.{10,80})/i];
    for (const p of patterns) { const m = text.match(p); if (m) return m[0].slice(0, 120); }
    return '';
  }
}
module.exports = { XProvider };
