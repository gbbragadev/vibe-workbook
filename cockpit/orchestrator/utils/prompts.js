'use strict';

/**
 * Formats the success criteria list as a numbered string.
 * @param {string[]} criteria
 * @returns {string}
 */
function formatCriteria(criteria) {
  if (!criteria || !criteria.length) return '  (none specified)';
  return criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
}

/**
 * Formats the constraints list as a bulleted string.
 * @param {string[]} constraints
 * @returns {string}
 */
function formatConstraints(constraints) {
  if (!constraints || !constraints.length) return '  (none specified)';
  return constraints.map(c => `  - ${c}`).join('\n');
}

const PROMPTS = {
  /**
   * Architecture lane prompt.
   * Generates a technical architecture proposal for the work item.
   * @param {object} workItem
   * @returns {string}
   */
  architecture(workItem) {
    return `You are a senior software architect. Your task is to produce a concise but complete technical architecture proposal for the following work item.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}
- Context: ${workItem.context}

## Constraints
${formatConstraints(workItem.constraints)}

## Success Criteria
${formatCriteria(workItem.success_criteria)}

## Your Output

Produce a Markdown document with the following sections:

1. **Overview** — 2–3 sentences describing the proposed solution.
2. **Tech Stack** — list of technologies, frameworks, and tools to be used (justify each choice briefly).
3. **Component Diagram** — ASCII or Mermaid diagram showing major components and their relationships.
4. **Data Flow** — describe how data moves through the system (input → processing → output/storage).
5. **File Structure** — proposed directory and file layout.
6. **Key Decisions** — architectural trade-offs and rationale.
7. **Open Questions** — anything that must be clarified before implementation begins.

Be specific and actionable. Avoid generic boilerplate. Focus on what is strictly necessary to meet the success criteria given the constraints.`;
  },

  /**
   * Planning lane prompt.
   * Breaks the work item into an ordered list of actionable tasks.
   * @param {object} workItem
   * @param {object} brief - architecture brief produced by the architecture lane
   * @returns {string}
   */
  planning(workItem, brief) {
    const briefText = brief
      ? (typeof brief === 'string' ? brief : JSON.stringify(brief, null, 2))
      : '(no architecture brief available)';

    return `You are a meticulous technical project manager. Your task is to convert the following work item and architecture brief into a detailed, ordered task board.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}
- Context: ${workItem.context}

## Architecture Brief
${briefText}

## Success Criteria
${formatCriteria(workItem.success_criteria)}

## Constraints
${formatConstraints(workItem.constraints)}

## Your Output

Produce a YAML document representing a flat list of tasks. Each task must have:
- id: T-NNN (sequential)
- title: short imperative title
- lane: one of [architecture, planning, research, build, qa, evaluation]
- depends_on: list of task IDs this task depends on (empty list if none)
- description: 1–3 sentences explaining what must be done
- acceptance_criteria: list of verifiable conditions

Order tasks by dependency. Include all tasks needed to fully deliver the work item and meet every success criterion.

Start your response with the YAML block (no preamble).`;
  },

  /**
   * Research lane prompt.
   * Produces a research report with findings relevant to the work item.
   * @param {object} workItem
   * @returns {string}
   */
  research(workItem) {
    return `You are a technical researcher. Your task is to gather and synthesize information relevant to the following work item, so that the implementation team can proceed with confidence.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}
- Context: ${workItem.context}

## Constraints
${formatConstraints(workItem.constraints)}

## Success Criteria
${formatCriteria(workItem.success_criteria)}

## Your Output

Produce a Markdown research report with the following sections:

1. **Problem Summary** — restate the core problem in your own words.
2. **Prior Art / References** — existing solutions, libraries, or patterns that are directly relevant.
3. **Technology Evaluation** — compare 2–3 options for any non-trivial technology choices; include pros/cons.
4. **Recommended Approach** — your recommended solution based on the constraints.
5. **Implementation Notes** — specific gotchas, edge cases, or non-obvious implementation details the build lane should know about.
6. **Resources** — links or references (real URLs where known; omit if unknown).

Be concrete. Flag uncertainty explicitly (e.g., "Unverified: …"). Do not hallucinate URLs.`;
  },

  /**
   * Build lane prompt.
   * Instructs the agent to generate a standalone HTML/CSS/JS Idea Backlog web app.
   * @param {object} workItem
   * @param {object} board   - task board produced by planning lane
   * @param {string} lane    - current lane name
   * @returns {string}
   */
  build(workItem, board, lane) {
    const boardText = board
      ? (typeof board === 'string' ? board : JSON.stringify(board, null, 2))
      : '(no task board available)';

    return `You are an expert frontend developer. Your task is to implement the following work item as a fully working standalone web application.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}
- Context: ${workItem.context}
- Current Lane: ${lane || 'build'}

## Constraints
${formatConstraints(workItem.constraints)}

## Success Criteria
${formatCriteria(workItem.success_criteria)}

## Task Board
${boardText}

## Deliverable: Idea Backlog Web App

You must produce a standalone web application — a single \`index.html\` file (with inline or co-located \`style.css\` and \`app.js\`) — that implements an **Idea Backlog** tool.

### Functional Requirements
1. **Add idea** — user fills in a title and selects a priority (High / Medium / Low), then clicks "Add". The idea appears in the list.
2. **Remove idea** — each idea has a "Delete" button that removes it from the list.
3. **Prioritize ideas** — ideas can be sorted or reordered by priority. Display priority visually (e.g., badge color).
4. **Persistence** — all ideas are stored in \`localStorage\` and restored on page load.
5. **Empty state** — show a friendly message when the backlog is empty.

### Non-Functional Requirements
- Works when opened directly in a browser via \`file://\` or \`http://localhost\`
- No external dependencies (no CDN, no npm, no bundler)
- Clean, modern UI — use CSS custom properties for theming
- Accessible: inputs have labels, buttons have descriptive text
- \`data-testid\` attributes on key interactive elements:
  - \`data-testid="idea-title-input"\` on the title input
  - \`data-testid="idea-priority-select"\` on the priority selector
  - \`data-testid="add-idea-btn"\` on the add button
  - \`data-testid="idea-list"\` on the container holding all ideas
  - \`data-testid="idea-item"\` on each idea row
  - \`data-testid="delete-idea-btn"\` on each delete button

### Output Format
Return three clearly labelled code blocks:

\`\`\`html
<!-- index.html — full file contents -->
\`\`\`

\`\`\`css
/* style.css — full file contents */
\`\`\`

\`\`\`javascript
// app.js — full file contents
\`\`\`

If you choose to produce a single self-contained \`index.html\` (inline CSS + JS), output only one block labelled \`index.html\` and explain briefly why.

Do not truncate any file. Output complete, runnable code.`;
  },

  /**
   * QA lane prompt.
   * Generates a Playwright test suite for the artifact produced by the build lane.
   * @param {object} workItem
   * @param {object} board - task board produced by planning lane
   * @returns {string}
   */
  qa(workItem, board) {
    const boardText = board
      ? (typeof board === 'string' ? board : JSON.stringify(board, null, 2))
      : '(no task board available)';

    return `You are a QA engineer specializing in end-to-end testing with Playwright. Your task is to write a comprehensive Playwright test suite for the artifact produced by the build lane.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}

## Success Criteria (must all be covered by tests)
${formatCriteria(workItem.success_criteria)}

## Task Board
${boardText}

## Artifact Under Test

A standalone web app (index.html) — the Idea Backlog app. It uses \`localStorage\` for persistence and exposes the following \`data-testid\` selectors:
- \`[data-testid="idea-title-input"]\` — text input for the idea title
- \`[data-testid="idea-priority-select"]\` — select for priority (High/Medium/Low)
- \`[data-testid="add-idea-btn"]\` — button to add idea
- \`[data-testid="idea-list"]\` — container for all idea rows
- \`[data-testid="idea-item"]\` — each idea row
- \`[data-testid="delete-idea-btn"]\` — delete button on each row

Assume the app is served at \`http://localhost:3458\` for testing purposes.

## Your Output

Produce a single Playwright test file (\`idea-backlog.spec.js\`) using \`@playwright/test\`. The file must:

1. Cover every success criterion with at least one test
2. Test the happy path (add idea → it appears in list)
3. Test deletion (add idea → delete → list is empty or reduced)
4. Test persistence (add idea → reload page → idea is still there)
5. Test empty state (fresh load with no ideas → empty state message visible)
6. Test priority display (add idea with High priority → badge/indicator visible)
7. Include \`beforeEach\` that clears localStorage before each test

Output the complete, runnable test file. Do not truncate. Use \`test.describe\` blocks to group related tests.`;
  },

  /**
   * Evaluation lane prompt.
   * Evaluates the evidence collected for the work item and produces a pass/fail verdict.
   * @param {object} workItem
   * @param {object} evidence - evidence object collected during the run
   * @returns {string}
   */
  evaluation(workItem, evidence) {
    const evidenceText = evidence
      ? (typeof evidence === 'string' ? evidence : JSON.stringify(evidence, null, 2))
      : '(no evidence available)';

    return `You are a senior engineering lead performing a final quality gate review. Your task is to evaluate the evidence collected for the following work item and produce a structured pass/fail verdict.

## Work Item
- ID: ${workItem.id}
- Title: ${workItem.title}
- Objective: ${workItem.objective}

## Success Criteria
${formatCriteria(workItem.success_criteria)}

## Evidence Collected
${evidenceText}

## Your Output

Produce a YAML document with the following structure:

\`\`\`yaml
verdict: pass | fail | partial
score: 0-100
summary: "One sentence summary of the overall result."
criteria_results:
  - criterion: "exact text of criterion"
    status: pass | fail | skip
    notes: "brief explanation"
issues:
  - severity: critical | major | minor
    description: "description of the issue"
    suggestion: "how to fix it"
next_step:
  action: merge | fix | rerun | escalate
  reason: "why this action is recommended"
\`\`\`

Be objective. Base your verdict strictly on the evidence provided. If evidence is missing for a criterion, mark it as skip and note it as an issue. Do not infer success without evidence.`;
  },
};

module.exports = { PROMPTS };
