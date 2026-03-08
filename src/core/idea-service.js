const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');
const IDEAS_FILE = path.join(ROOT_DIR, 'state', 'ideas.json');

const STATUS_TRANSITIONS = {
  new: ['reviewing'],
  reviewing: ['approved', 'rejected'],
  approved: ['converted'],
  rejected: ['reviewing'],
  converted: []
};

const SCORE_WEIGHTS = {
  painFrequency: 1.5,
  painIntensity: 1.5,
  useCaseClarity: 1.2,
  workaroundPresence: 1.0,
  nichePotential: 1.0,
  productFit: 0.8
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class IdeaService {
  constructor(opts = {}) {
    this.filePath = opts.filePath || IDEAS_FILE;
  }

  _read() {
    return readJson(this.filePath, { version: 1, ideas: [] });
  }

  _write(data) {
    writeJsonAtomic(this.filePath, data);
  }

  getIdeas(filters = {}) {
    let ideas = this._read().ideas;
    if (filters.status) ideas = ideas.filter(i => i.status === filters.status);
    if (filters.opportunityType) ideas = ideas.filter(i => i.opportunityType === filters.opportunityType);
    return ideas;
  }

  getIdeaById(id) {
    return this._read().ideas.find(i => i.id === id) || null;
  }

  createIdea(payload) {
    const title = (payload.title || '').trim();
    if (!title) return { error: 'Title is required' };

    const now = new Date().toISOString();
    const idea = {
      id: 'idea-' + crypto.randomBytes(4).toString('hex'),
      title,
      summary: payload.summary || '',
      problem: payload.problem || '',
      audience: payload.audience || [],
      opportunityType: payload.opportunityType || 'other',
      tags: payload.tags || [],
      score: 0,
      confidence: 0,
      status: 'new',
      suggestedNextStep: payload.suggestedNextStep || '',
      signals: payload.signals || [],
      sources: payload.sources || [],
      _dimensions: payload._dimensions || {},
      createdAt: now,
      updatedAt: now
    };

    const data = this._read();
    data.ideas.push(idea);
    this._write(data);
    return idea;
  }

  updateIdea(id, updates) {
    const data = this._read();
    const idx = data.ideas.findIndex(i => i.id === id);
    if (idx === -1) return { error: 'Not found' };
    const forbidden = ['id', 'createdAt'];
    for (const key of Object.keys(updates)) {
      if (!forbidden.includes(key)) data.ideas[idx][key] = updates[key];
    }
    data.ideas[idx].updatedAt = new Date().toISOString();
    this._write(data);
    return data.ideas[idx];
  }

  updateIdeaStatus(id, newStatus) {
    const data = this._read();
    const idea = data.ideas.find(i => i.id === id);
    if (!idea) return { error: 'Not found' };
    const allowed = STATUS_TRANSITIONS[idea.status] || [];
    if (!allowed.includes(newStatus)) {
      return { error: `Cannot transition from ${idea.status} to ${newStatus}` };
    }
    idea.status = newStatus;
    idea.updatedAt = new Date().toISOString();
    this._write(data);
    return idea;
  }

  deleteIdea(id) {
    const data = this._read();
    data.ideas = data.ideas.filter(i => i.id !== id);
    this._write(data);
  }

  addSignals(id, signals) {
    const data = this._read();
    const idea = data.ideas.find(i => i.id === id);
    if (!idea) return { error: 'Not found' };
    idea.signals = (idea.signals || []).concat(signals);
    for (const sig of signals) {
      if (sig.sourceUrl && !idea.sources.some(s => s.url === sig.sourceUrl)) {
        idea.sources.push({ type: sig.sourceType, label: sig.sourceName, url: sig.sourceUrl });
      }
    }
    const scored = IdeaService.calculateScore(idea);
    idea.score = scored.score;
    idea.confidence = scored.confidence;
    idea.updatedAt = new Date().toISOString();
    this._write(data);
    return idea;
  }

  static calculateScore(idea) {
    const dims = idea._dimensions || {};
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
      const val = dims[key] || 0;
      weightedSum += val * weight;
      totalWeight += weight;
    }
    const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

    const signals = idea.signals || [];
    const signalFactor = Math.min(1.0, signals.length / 5);
    const avgRelevance = signals.length > 0
      ? signals.reduce((sum, s) => sum + (s.relevanceScore || 0), 0) / signals.length
      : 0;
    const confidence = Math.round((signalFactor * 0.5 + avgRelevance * 0.5) * 100) / 100;

    return { score, confidence };
  }
}

let instance = null;
function getIdeaService() {
  if (!instance) instance = new IdeaService();
  return instance;
}

module.exports = { IdeaService, getIdeaService };
