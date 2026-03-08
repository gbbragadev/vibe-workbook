const crypto = require('crypto');
const { BaseDiscoveryProvider } = require('./base-provider');

class RedditProvider extends BaseDiscoveryProvider {
  constructor(opts = {}) {
    super({ name: 'reddit', sourceType: 'reddit' });
    this.userAgent = opts.userAgent || 'nodejs:vibe-workbook:1.0.0';
    this.subreddits = opts.subreddits || [
      'SaaS', 'smallbusiness', 'Entrepreneur', 'startups', 'webdev',
      'AutomateYourself', 'nocode', 'sideproject', 'microsaas'
    ];
  }

  async discover(query) {
    const results = [];
    const searchQueries = this._buildSearchQueries(query);

    for (const sq of searchQueries) {
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(sq)}&sort=relevance&limit=10&t=year`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/json'
          }
        });
        if (!resp.ok) {
          if (resp.status === 429) {
            console.warn('[RedditProvider] Rate limited, stopping batch');
            break;
          }
          continue;
        }
        const json = await resp.json();
        const posts = (json?.data?.children || []).filter(c => c.kind === 't3');
        results.push(...posts);
        await new Promise(r => setTimeout(r, 6500));
      } catch (err) {
        console.warn(`[RedditProvider] Error fetching "${sq}":`, err.message);
      }
    }

    const seen = new Set();
    return results.filter(r => {
      const id = r.data?.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  _buildSearchQueries(query) {
    const base = query || 'automation tool';
    const painSignals = [
      `"I hate" ${base}`,
      `"there should be a tool" ${base}`,
      `"looking for a tool" ${base}`,
      `"anyone struggling with" ${base}`,
      `"how do you automate" ${base}`,
      `"spreadsheet" ${base}`,
      `"is there a better way" ${base}`
    ];
    return [base, ...painSignals.slice(0, 3)];
  }

  normalizeSignal(raw) {
    const d = raw.data || raw;
    const text = (d.selftext || '').slice(0, 2000);
    const title = d.title || '';
    return {
      id: 'sig-' + crypto.randomBytes(4).toString('hex'),
      sourceType: 'reddit',
      sourceName: 'r/' + (d.subreddit || 'unknown'),
      sourceUrl: d.permalink ? `https://www.reddit.com${d.permalink}` : '',
      authorHandle: d.author || '',
      capturedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
      rawTitle: title,
      rawText: text,
      extractedPain: this._extractPain(title + ' ' + text),
      extractedDesire: this._extractDesire(title + ' ' + text),
      extractedUseCase: this._extractUseCase(title + ' ' + text),
      engagement: {
        score: d.score || 0,
        comments: d.num_comments || 0,
        likes: d.ups || 0,
        shares: 0
      },
      relevanceScore: this._calcRelevance(d)
    };
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

  _calcRelevance(d) {
    let score = 0.3;
    if ((d.num_comments || 0) > 10) score += 0.15;
    if ((d.score || 0) > 30) score += 0.15;
    const text = ((d.selftext || '') + ' ' + (d.title || '')).toLowerCase();
    if (/automat|tool|workflow|dashboard|template/.test(text)) score += 0.2;
    if (/hate|frustrat|tedious|manual|struggling/.test(text)) score += 0.2;
    return Math.min(1.0, Math.round(score * 100) / 100);
  }
}
module.exports = { RedditProvider };
