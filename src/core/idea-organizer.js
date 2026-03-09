const CATEGORIES = {
  'operations': {
    label: 'Operations & Workflows',
    subcategories: ['data-management', 'document-processing', 'scheduling', 'reporting', 'compliance'],
    keywords: ['spreadsheet', 'manual', 'data entry', 'workflow', 'process', 'operations', 'report', 'tracking', 'manage']
  },
  'sales-marketing': {
    label: 'Sales & Marketing',
    subcategories: ['lead-gen', 'analytics', 'content', 'pricing', 'crm'],
    keywords: ['leads', 'marketing', 'sales', 'pricing', 'competitor', 'campaign', 'social media', 'seo', 'ads', 'crm']
  },
  'engineering': {
    label: 'Engineering & DevOps',
    subcategories: ['monitoring', 'ci-cd', 'testing', 'infrastructure', 'developer-tools'],
    keywords: ['deploy', 'backup', 'monitoring', 'ci/cd', 'database', 'api', 'github', 'jira', 'code', 'server', 'devops']
  },
  'hr-people': {
    label: 'HR & People',
    subcategories: ['onboarding', 'payroll', 'recruiting', 'performance'],
    keywords: ['onboarding', 'hr', 'employee', 'hiring', 'training', 'payroll', 'recruiting', 'team']
  },
  'finance': {
    label: 'Finance & Accounting',
    subcategories: ['invoicing', 'expense', 'budgeting', 'contracts'],
    keywords: ['invoice', 'payment', 'accounting', 'budget', 'contract', 'billing', 'quickbooks', 'expense', 'tax', 'financial']
  },
  'customer-success': {
    label: 'Customer Success',
    subcategories: ['support', 'feedback', 'retention', 'nps'],
    keywords: ['support', 'ticket', 'customer', 'feedback', 'churn', 'satisfaction', 'helpdesk', 'onboard']
  },
  'other': {
    label: 'Other',
    subcategories: ['general'],
    keywords: []
  }
};

class IdeaOrganizer {
  constructor(opts = {}) {
    this.ideaService = opts.ideaService || null;
  }

  classify(signals) {
    const text = signals.map(s =>
      [s.extractedPain, s.extractedDesire, s.extractedUseCase, s.rawTitle].filter(Boolean).join(' ')
    ).join(' ').toLowerCase();

    let bestCategory = 'other';
    let bestScore = 0;
    let bestSubcategory = 'general';

    for (const [cat, meta] of Object.entries(CATEGORIES)) {
      if (cat === 'other') continue;
      let score = 0;
      for (const kw of meta.keywords) {
        if (text.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
        bestSubcategory = meta.subcategories[0];
        for (const sub of meta.subcategories) {
          if (text.includes(sub.replace('-', ' ')) || text.includes(sub.replace('-', ''))) {
            bestSubcategory = sub;
            break;
          }
        }
      }
    }

    return { category: bestCategory, subcategory: bestSubcategory };
  }

  assessNoise(signals) {
    let noise = 0;

    const hasPain = signals.filter(s => s.extractedPain).length;
    const hasUseCase = signals.filter(s => s.extractedUseCase).length;
    const avgEng = signals.reduce((sum, s) => sum + (s.engagement?.score || 0), 0) / (signals.length || 1);
    const avgComments = signals.reduce((sum, s) => sum + (s.engagement?.comments || 0), 0) / (signals.length || 1);
    const sourceTypes = new Set(signals.map(s => s.sourceType));
    const avgTextLen = signals.reduce((sum, s) => sum + (s.rawText || '').length, 0) / (signals.length || 1);
    const hasWorkaround = signals.some(s =>
      /workaround|currently using|spreadsheet|manually/.test((s.rawText || '').toLowerCase())
    );

    // Noise up
    if (hasPain === 0) noise += 3;
    if (hasUseCase === 0) noise += 2;
    if (avgEng < 5) noise += 2;
    if (sourceTypes.size <= 1 && signals.length > 1) noise += 1;
    if (avgTextLen < 50) noise += 1;
    if (avgComments === 0) noise += 1;

    // Noise down
    if (hasPain >= 2 && sourceTypes.size > 1) noise -= 2;
    if (avgEng > 100) noise -= 2;
    else if (avgEng > 30) noise -= 1;
    if (hasWorkaround) noise -= 1;

    return Math.max(0, Math.min(10, noise));
  }

  generateRationale(signals, category, noiseLevel) {
    const sourceNames = [...new Set(signals.map(s => s.sourceName).filter(Boolean))];
    const pains = signals.map(s => s.extractedPain).filter(Boolean);
    const avgEng = Math.round(signals.reduce((s, x) => s + (x.engagement?.score || 0), 0) / (signals.length || 1));
    const avgComments = Math.round(signals.reduce((s, x) => s + (x.engagement?.comments || 0), 0) / (signals.length || 1));

    const catLabel = (CATEGORIES[category] || CATEGORIES.other).label;
    const confidenceWord = noiseLevel <= 3 ? 'High confidence' : noiseLevel <= 6 ? 'Moderate confidence' : 'Low confidence';

    const parts = [];
    parts.push(`${signals.length} signal(s) from ${sourceNames.join(', ') || 'unknown'} in ${catLabel}`);
    if (pains.length) parts.push(pains[0].slice(0, 100));
    if (avgEng > 10 || avgComments > 5) parts.push(`Engagement: avg ${avgEng} upvotes, ${avgComments} comments`);
    parts.push(confidenceWord);

    return parts.join('. ') + '.';
  }

  suggestAction(noiseLevel, signals, dimensions) {
    if (noiseLevel >= 9) return 'discard';
    if (noiseLevel >= 7) return 'review';
    const avgEng = signals.reduce((s, x) => s + (x.engagement?.score || 0), 0) / (signals.length || 1);
    if (noiseLevel < 3 && signals.length >= 3 && avgEng > 50) return 'convert_to_product';
    if (signals.length >= 3) return 'explore';
    return 'review';
  }

  organizeAndCreate(signalGroup, rawDimensions, rawMeta) {
    const { category, subcategory } = this.classify(signalGroup);
    const noiseLevel = this.assessNoise(signalGroup);
    const rationale = this.generateRationale(signalGroup, category, noiseLevel);
    const suggestedAction = this.suggestAction(noiseLevel, signalGroup, rawDimensions);

    // Auto-discard pure noise (noiseLevel >= 9)
    if (suggestedAction === 'discard' && noiseLevel >= 9) return null;

    const payload = {
      ...rawMeta,
      signals: signalGroup,
      sources: signalGroup.map(s => ({ type: s.sourceType, label: s.sourceName, url: s.sourceUrl }))
        .filter((v, i, a) => a.findIndex(x => x.url === v.url) === i),
      _dimensions: rawDimensions,
      category,
      subcategory,
      noiseLevel,
      rationale,
      suggestedAction,
      organizedAt: new Date().toISOString()
    };

    if (this.ideaService) {
      return this.ideaService.createIdea(payload);
    }
    return payload;
  }

  reEnrich(ideaId) {
    if (!this.ideaService) return null;
    const idea = this.ideaService.getIdeaById(ideaId);
    if (!idea) return null;

    const signals = idea.signals || [];
    if (!signals.length) return idea;

    const { category, subcategory } = this.classify(signals);
    const noiseLevel = this.assessNoise(signals);
    const rationale = this.generateRationale(signals, category, noiseLevel);
    const suggestedAction = this.suggestAction(noiseLevel, signals, idea._dimensions || {});

    return this.ideaService.updateIdea(ideaId, {
      category, subcategory, noiseLevel, rationale, suggestedAction,
      organizedAt: new Date().toISOString()
    });
  }
}

let instance = null;
function getIdeaOrganizer() {
  if (!instance) instance = new IdeaOrganizer();
  return instance;
}

module.exports = { IdeaOrganizer, getIdeaOrganizer, CATEGORIES };
