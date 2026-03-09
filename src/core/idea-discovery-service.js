const crypto = require('crypto');
const { computeFingerprint } = require('./signal-fingerprint');

const STOP_WORDS = new Set(['i','me','my','the','a','an','is','are','was','were','be',
  'been','being','have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','can','to','of','in','for','on','with','at','by','from','as',
  'into','through','during','before','after','above','below','between','out','off',
  'over','under','again','further','then','once','here','there','when','where','why',
  'how','all','each','every','both','few','more','most','other','some','such','no',
  'not','only','own','same','so','than','too','very','just','because','but','and',
  'or','if','while','about','up','it','its','this','that','these','those','what','which']);

class IdeaDiscoveryService {
  constructor(opts = {}) {
    this.providers = [];
    this.ideaService = opts.ideaService || null;
    this.organizer = opts.organizer || null;
    this._activeRun = null;
    this._onProgress = opts.onProgress || null;
  }

  registerProvider(provider) { this.providers.push(provider); }
  getProviders() { return this.providers; }

  getDiscoveryStatus() {
    return this._activeRun || { status: 'idle' };
  }

  async startDiscovery(query) {
    if (this._activeRun && this._activeRun.status === 'running') {
      return { error: 'Discovery already running' };
    }
    const runId = 'disc-' + crypto.randomBytes(4).toString('hex');
    this._activeRun = {
      id: runId, status: 'running', query,
      startedAt: new Date().toISOString(),
      progress: { total: this.providers.length, completed: 0, signals: 0, signalsDeduped: 0 }
    };

    try {
      const allSignals = [];
      for (const provider of this.providers) {
        const rawResults = await provider.discover(query);
        const normalized = rawResults.map(r => provider.normalizeSignal(r));
        // Add fingerprint to each signal
        for (const sig of normalized) {
          sig.fingerprint = computeFingerprint(sig);
        }
        // Filter out existing fingerprints
        const existingFps = this.ideaService ? this.ideaService.getAllSignalFingerprints() : new Set();
        const fresh = normalized.filter(s => !existingFps.has(s.fingerprint));
        allSignals.push(...fresh);
        this._activeRun.progress.signalsDeduped += (normalized.length - fresh.length);
        this._activeRun.progress.completed++;
        this._activeRun.progress.signals = allSignals.length;
        if (this._onProgress) this._onProgress(this._activeRun);
      }

      const groups = this._groupSignalsIntoIdeas(allSignals);
      let ideasCreated = 0;
      let ideasUpdated = 0;

      for (const group of groups) {
        const dims = this._estimateDimensions(group);
        const rawMeta = {
          title: this._deriveTitle(group),
          summary: this._deriveSummary(group),
          problem: group[0].extractedPain || group[0].rawTitle,
          audience: [],
          opportunityType: this._guessOpportunityType(group),
          tags: this._extractTags(group),
          suggestedNextStep: 'Review signals and validate problem'
        };

        // Try merge-or-create
        const existingIdea = this.ideaService.findSimilarIdea(rawMeta.title, rawMeta.tags);
        if (existingIdea) {
          this.ideaService.addSignals(existingIdea.id, group);
          if (this.organizer) this.organizer.reEnrich(existingIdea.id);
          ideasUpdated++;
        } else {
          let idea;
          if (this.organizer) {
            idea = this.organizer.organizeAndCreate(group, dims, rawMeta);
          } else {
            idea = this.ideaService.createIdea({
              ...rawMeta,
              signals: group,
              sources: group.map(s => ({ type: s.sourceType, label: s.sourceName, url: s.sourceUrl }))
                .filter((v, i, a) => a.findIndex(x => x.url === v.url) === i),
              _dimensions: dims
            });
          }
          if (idea && !idea.error) ideasCreated++;
        }
      }

      this._activeRun.status = 'completed';
      this._activeRun.ideasCreated = ideasCreated;
      this._activeRun.ideasUpdated = ideasUpdated;
      this._activeRun.signalsCollected = allSignals.length;
      this._activeRun.completedAt = new Date().toISOString();
      return this._activeRun;

    } catch (err) {
      this._activeRun.status = 'error';
      this._activeRun.error = err.message;
      return this._activeRun;
    }
  }

  _groupSignalsIntoIdeas(signals) {
    const keyworded = signals.map(s => ({
      signal: s,
      keywords: this._extractKeywords(
        (s.extractedUseCase || '') + ' ' + (s.extractedPain || '') + ' ' + (s.rawTitle || '')
      )
    }));

    const groups = [];
    const used = new Set();

    for (let i = 0; i < keyworded.length; i++) {
      if (used.has(i)) continue;
      const group = [keyworded[i].signal];
      used.add(i);
      for (let j = i + 1; j < keyworded.length; j++) {
        if (used.has(j)) continue;
        const shared = keyworded[i].keywords.filter(k => keyworded[j].keywords.includes(k));
        if (shared.length >= 2) {
          group.push(keyworded[j].signal);
          used.add(j);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  _extractKeywords(text) {
    return (text || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  _deriveTitle(signals) {
    const best = signals.sort((a, b) =>
      (b.engagement?.score || 0) - (a.engagement?.score || 0)
    )[0];
    return best.extractedUseCase || best.rawTitle || 'Untitled Idea';
  }

  _deriveSummary(signals) {
    const pains = signals.map(s => s.extractedPain).filter(Boolean);
    const desires = signals.map(s => s.extractedDesire).filter(Boolean);
    return [
      pains.length ? `Pain: ${pains[0]}` : '',
      desires.length ? `Desire: ${desires[0]}` : '',
      `${signals.length} signal(s) collected`
    ].filter(Boolean).join('. ');
  }

  _guessOpportunityType(signals) {
    const text = signals.map(s => (s.extractedUseCase || '') + ' ' + (s.rawText || '')).join(' ').toLowerCase();
    if (text.includes('automat')) return 'automation';
    if (text.includes('dashboard')) return 'dashboard';
    if (text.includes('template')) return 'template';
    if (text.includes('workflow')) return 'workflow';
    if (text.includes('agent') || text.includes('copilot')) return 'agent';
    if (text.includes('integrat')) return 'integration';
    return 'micro_saas';
  }

  _extractTags(signals) {
    const allKeywords = signals.flatMap(s => this._extractKeywords(
      (s.extractedUseCase || '') + ' ' + (s.extractedPain || '')
    ));
    const freq = {};
    for (const k of allKeywords) freq[k] = (freq[k] || 0) + 1;
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
  }

  _estimateDimensions(signals) {
    const avgEng = signals.reduce((s, x) => s + (x.engagement?.score || 0), 0) / signals.length;
    const avgComments = signals.reduce((s, x) => s + (x.engagement?.comments || 0), 0) / signals.length;
    const hasPain = signals.filter(s => s.extractedPain).length;
    const hasUseCase = signals.filter(s => s.extractedUseCase).length;
    const hasWorkaround = signals.filter(s =>
      /workaround|currently using|spreadsheet|manually/.test((s.rawText || '').toLowerCase())
    ).length;
    const sourceTypes = new Set(signals.map(s => s.sourceType).filter(Boolean));
    const isCrossPlatform = sourceTypes.size > 1;

    // nichePotential: base 3 + bonuses
    let nichePotential = 3;
    if (isCrossPlatform) nichePotential += 2;
    if (signals.length >= 3) nichePotential += 1;
    if (signals.length >= 5) nichePotential += 1;
    if (avgComments > 10) nichePotential += 1;
    if (avgComments > 30) nichePotential += 1;

    // productFit: base 2 + bonuses
    let productFit = 2;
    if (hasUseCase > 0) productFit += 3;
    if (hasWorkaround > 0) productFit += 2;
    if (hasPain / signals.length > 0.5) productFit += 2;
    if (isCrossPlatform) productFit += 1;

    return {
      painFrequency: Math.min(10, Math.round(signals.length * 2)),
      painIntensity: Math.min(10, Math.round((hasPain / signals.length) * 8 + (avgEng > 50 ? 2 : 0))),
      useCaseClarity: Math.min(10, Math.round((hasUseCase / signals.length) * 10)),
      workaroundPresence: Math.min(10, Math.round((hasWorkaround / signals.length) * 10)),
      nichePotential: Math.min(10, nichePotential),
      productFit: Math.min(10, productFit)
    };
  }
}

let instance = null;
function getIdeaDiscoveryService() {
  if (!instance) instance = new IdeaDiscoveryService();
  return instance;
}

module.exports = { IdeaDiscoveryService, getIdeaDiscoveryService };
