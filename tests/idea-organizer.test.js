const { describe, it } = require('node:test');
const assert = require('node:assert');
const { IdeaOrganizer } = require('../src/core/idea-organizer');

describe('IdeaOrganizer', () => {
  const organizer = new IdeaOrganizer();

  describe('classify', () => {
    it('classifies invoice signals as finance', () => {
      const signals = [{ extractedPain: 'invoice payment billing overdue', rawTitle: 'invoice accounting expense' }];
      const result = organizer.classify(signals);
      assert.strictEqual(result.category, 'finance');
    });

    it('classifies deploy signals as engineering', () => {
      const signals = [{ extractedPain: 'deploy takes too long', rawTitle: 'ci/cd pipeline broken' }];
      const result = organizer.classify(signals);
      assert.strictEqual(result.category, 'engineering');
    });

    it('defaults to other for unclassifiable signals', () => {
      const signals = [{ extractedPain: '', rawTitle: 'random post' }];
      const result = organizer.classify(signals);
      assert.strictEqual(result.category, 'other');
    });
  });

  describe('assessNoise', () => {
    it('returns high noise for empty pain signals', () => {
      const signals = [{ extractedPain: '', extractedUseCase: '', rawText: 'short', engagement: { score: 1, comments: 0 } }];
      assert.ok(organizer.assessNoise(signals) >= 7);
    });

    it('returns low noise for rich multi-source signals', () => {
      const signals = [
        { extractedPain: 'manual work', extractedUseCase: 'automate invoices', rawText: 'a'.repeat(200), sourceType: 'reddit', engagement: { score: 150, comments: 30 } },
        { extractedPain: 'tedious process', extractedUseCase: 'workflow tool', rawText: 'b'.repeat(200), sourceType: 'web', engagement: { score: 80, comments: 15 } }
      ];
      assert.ok(organizer.assessNoise(signals) <= 3);
    });
  });

  describe('suggestAction', () => {
    it('returns discard for high noise', () => {
      assert.strictEqual(organizer.suggestAction(9, [], {}), 'discard');
    });

    it('returns explore for moderate noise + multiple signals', () => {
      const signals = [{}, {}, {}];
      assert.strictEqual(organizer.suggestAction(4, signals, {}), 'explore');
    });
  });

  describe('generateRationale', () => {
    it('produces non-empty string', () => {
      const signals = [{ sourceType: 'reddit', sourceName: 'r/SaaS', extractedPain: 'manual invoicing', engagement: { score: 50, comments: 10 } }];
      const rationale = organizer.generateRationale(signals, 'finance', 3);
      assert.ok(rationale.length > 20);
    });
  });

  describe('organizeAndCreate', () => {
    it('returns null for pure noise (noiseLevel >= 9)', () => {
      const signals = [{ extractedPain: '', extractedUseCase: '', rawText: '', engagement: { score: 0, comments: 0 } }];
      const result = organizer.organizeAndCreate(signals, {}, { title: 'Noise' });
      assert.strictEqual(result, null);
    });

    it('returns enriched payload for valid signals', () => {
      const signals = [
        { extractedPain: 'manual invoicing', extractedUseCase: 'automate billing', rawTitle: 'Invoice tool', sourceType: 'reddit', sourceName: 'r/SaaS', sourceUrl: 'https://example.com/1', rawText: 'a'.repeat(100), engagement: { score: 50, comments: 10 } }
      ];
      const result = organizer.organizeAndCreate(signals, { painFrequency: 5 }, { title: 'Invoice Automation' });
      assert.ok(result);
      assert.ok(result.category);
      assert.ok(typeof result.noiseLevel === 'number');
      assert.ok(result.rationale);
      assert.ok(result.suggestedAction);
    });
  });
});
