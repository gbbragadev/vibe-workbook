'use strict';

const CHECKS = [
  {
    question: 'Is the work item specific enough to act on?',
    test: (brief) => brief.length > 200,
    reason_pass: 'Brief exceeds 200 characters — sufficient specificity.',
    reason_fail: 'Brief is too short (≤200 characters) — not specific enough to act on.',
  },
  {
    question: 'Is the intended user or operator clear?',
    test: (brief) => /\b(user|operator|human|developer)\b/i.test(brief),
    reason_pass: 'Brief mentions intended user or operator.',
    reason_fail: 'Brief does not mention "user", "operator", "human", or "developer".',
  },
  {
    question: 'Is the smallest useful increment defined?',
    test: (brief) => /\b(increment|mvp|milestone|first|slice)\b/i.test(brief),
    reason_pass: 'Brief defines a smallest useful increment (MVP / milestone / first slice).',
    reason_fail: 'Brief does not mention "increment", "MVP", "milestone", "first", or "slice".',
  },
  {
    question: 'Are scope boundaries explicit?',
    test: (brief) => /\b(scope|boundary|constraint|limit|non.?goal|out of)\b/i.test(brief),
    reason_pass: 'Brief explicitly defines scope boundaries.',
    reason_fail: 'Brief does not mention scope, boundaries, constraints, limits, or non-goals.',
  },
  {
    question: 'Are input and output contracts defined?',
    test: (brief) => /\b(input|output|contract|interface|api)\b/i.test(brief),
    reason_pass: 'Brief defines input/output contracts or interfaces.',
    reason_fail: 'Brief does not mention inputs, outputs, contracts, interfaces, or APIs.',
  },
  {
    question: 'Are known risks and fallback paths documented?',
    test: (brief) => /\b(risk|fallback|mitigation|error)\b/i.test(brief),
    reason_pass: 'Brief documents risks, fallbacks, or mitigations.',
    reason_fail: 'Brief does not mention risks, fallbacks, mitigations, or error handling.',
  },
  {
    question: 'Can tasks be executed without re-discovering core intent?',
    test: (brief) => brief.length > 500 && (brief.match(/^##\s/gm) || []).length >= 3,
    reason_pass: 'Brief is sufficiently detailed (>500 chars, ≥3 sections).',
    reason_fail: 'Brief lacks detail: must exceed 500 characters AND contain at least 3 "##" sections.',
  },
];

class Gate {
  /**
   * Runs the architecture gate against a brief (markdown string).
   * @param {string} brief
   * @returns {{ passed: boolean, checks: Array<{ question: string, passed: boolean, reason: string }> }}
   */
  validateArchitectureGate(brief) {
    if (typeof brief !== 'string') {
      brief = '';
    }

    const checks = CHECKS.map((check) => {
      const passed = check.test(brief);
      return {
        question: check.question,
        passed,
        reason: passed ? check.reason_pass : check.reason_fail,
      };
    });

    const passed = checks.every((c) => c.passed);

    return { passed, checks };
  }
}

module.exports = { Gate };
