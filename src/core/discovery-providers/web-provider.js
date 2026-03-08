const crypto = require('crypto');
const cheerio = require('cheerio');
const { BaseDiscoveryProvider } = require('./base-provider');

class WebProvider extends BaseDiscoveryProvider {
  constructor(opts = {}) {
    super({ name: 'web', sourceType: 'web' });
    this.userAgent = opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  async discover(query) {
    const results = [];
    const searchQueries = this._buildSearchQueries(query);

    for (const sq of searchQueries) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html'
          }
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        const parsed = this._parseResults(html);
        results.push(...parsed);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[WebProvider] Error fetching "${sq}":`, err.message);
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
      `${base} "I hate" OR "there should be" OR "looking for a tool"`,
      `${base} "anyone struggling" OR "how do you automate" OR "better way to"`,
      `site:reddit.com ${base} automation OR workflow OR tool`
    ];
  }

  _parseResults(html) {
    const $ = cheerio.load(html);
    const results = [];
    $('.result').each((i, el) => {
      const $el = $(el);
      const title = $el.find('.result__title .result__a').text().trim();
      const snippet = $el.find('.result__snippet').text().trim();
      const url = $el.find('.result__title .result__a').attr('href') || '';
      if (title && snippet) {
        results.push({ title, snippet, url: this._cleanUrl(url) });
      }
    });
    return results.slice(0, 15);
  }

  _cleanUrl(url) {
    try {
      if (url.includes('uddg=')) {
        return decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
      }
      return url;
    } catch { return url; }
  }

  normalizeSignal(raw) {
    return {
      id: 'sig-' + crypto.randomBytes(4).toString('hex'),
      sourceType: 'web',
      sourceName: this._extractDomain(raw.url),
      sourceUrl: raw.url || '',
      authorHandle: '',
      capturedAt: new Date().toISOString(),
      rawTitle: raw.title || '',
      rawText: raw.snippet || '',
      extractedPain: this._extractPain(raw.title + ' ' + raw.snippet),
      extractedDesire: this._extractDesire(raw.title + ' ' + raw.snippet),
      extractedUseCase: this._extractUseCase(raw.title + ' ' + raw.snippet),
      engagement: { score: 0, comments: 0, likes: 0, shares: 0 },
      relevanceScore: this._calcRelevance(raw)
    };
  }

  _extractDomain(url) {
    try { return new URL(url).hostname; } catch { return 'web'; }
  }

  _extractPain(text) {
    const patterns = [/I hate (.{10,80})/i, /struggling with (.{10,80})/i,
      /frustrating (.{10,80})/i, /waste.{0,10}time (.{10,80})/i,
      /manually (.{10,60})/i, /tedious (.{10,60})/i];
    for (const p of patterns) { const m = text.match(p); if (m) return m[0].slice(0, 120); }
    return '';
  }

  _extractDesire(text) {
    const patterns = [/looking for (.{10,80})/i, /wish there was (.{10,80})/i,
      /there should be (.{10,80})/i, /need.{0,10}tool (.{10,80})/i,
      /would love (.{10,80})/i, /want to automate (.{10,80})/i];
    for (const p of patterns) { const m = text.match(p); if (m) return m[0].slice(0, 120); }
    return '';
  }

  _extractUseCase(text) {
    const patterns = [/automate (.{10,80})/i, /build .{0,10}(?:tool|app|dashboard|workflow) (.{10,80})/i,
      /how do you (.{10,80})/i, /better way to (.{10,80})/i];
    for (const p of patterns) { const m = text.match(p); if (m) return m[0].slice(0, 120); }
    return '';
  }

  _calcRelevance(raw) {
    let score = 0.3;
    const text = ((raw.title || '') + ' ' + (raw.snippet || '')).toLowerCase();
    if (/automat|tool|workflow|dashboard|template/.test(text)) score += 0.2;
    if (/hate|frustrat|tedious|manual|struggling/.test(text)) score += 0.2;
    if (/looking for|wish|should be|better way/.test(text)) score += 0.15;
    return Math.min(1.0, Math.round(score * 100) / 100);
  }
}
module.exports = { WebProvider };
