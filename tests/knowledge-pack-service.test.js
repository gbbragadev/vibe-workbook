const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { KnowledgePackService } = require('../src/core/knowledge-pack-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-knowledge-test-'));
}

test('knowledge pack service resolves catalog, bindings and current stage recommendations', () => {
  const dir = makeTempDir();
  const catalogDir = path.join(dir, 'catalog');
  fs.mkdirSync(catalogDir, { recursive: true });

  fs.writeFileSync(path.join(catalogDir, 'index.json'), JSON.stringify({
    version: 1,
    knowledge_packs: [
      { id: 'pm-skills', manifest: 'pm-skills.pack.json' }
    ]
  }, null, 2));

  fs.writeFileSync(path.join(catalogDir, 'pm-skills.pack.json'), JSON.stringify({
    id: 'pm-skills',
    name: 'PM Skills',
    source: 'external-github',
    type: 'skills-pack',
    repo_url: 'https://github.com/phuryn/pm-skills',
    domains: ['product-discovery'],
    supported_runtimes: ['claude', 'codex'],
    integration_mode: 'reference-first',
    status: 'active'
  }, null, 2));

  const bindingsFile = path.join(dir, 'bindings.json');
  fs.writeFileSync(bindingsFile, JSON.stringify({
    version: 1,
    bindings: [
      {
        product_id: 'zapcam',
        knowledge_pack_id: 'pm-skills',
        enabled: true,
        notes: 'active binding'
      }
    ]
  }, null, 2));

  const recommendationsFile = path.join(dir, 'recommendations.json');
  fs.writeFileSync(recommendationsFile, JSON.stringify({
    version: 1,
    recommendations: [
      {
        knowledge_pack_id: 'pm-skills',
        stage_id: 'brief',
        recommended_skills: ['identify-assumptions-new'],
        recommended_workflows: ['/discover'],
        recommended_roles: ['product-designer'],
        recommended_runtime_agents: ['claude']
      }
    ]
  }, null, 2));

  const service = new KnowledgePackService({
    catalogDir,
    indexFile: path.join(catalogDir, 'index.json'),
    bindingsFile,
    recommendationsFile
  });

  const knowledge = service.buildProductKnowledge(
    { product_id: 'zapcam', name: 'Zapcam' },
    [
      { stage_id: 'idea', label: 'Idea', status: 'done' },
      { stage_id: 'brief', label: 'Brief', status: 'ready' }
    ],
    'brief'
  );

  assert.equal(service.getKnowledgePacks().length, 1);
  assert.equal(knowledge.active_packs.length, 1);
  assert.equal(knowledge.current_stage_id, 'brief');
  assert.equal(knowledge.current_stage_recommendations.length, 1);
  assert.equal(knowledge.stage_recommendations[1].recommendations[0].knowledge_pack_id, 'pm-skills');
});
