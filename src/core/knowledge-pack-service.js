const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const CATALOG_DIR = path.join(ROOT_DIR, 'platform', 'catalog', 'knowledge-packs');
const INDEX_FILE = path.join(CATALOG_DIR, 'index.json');
const BINDINGS_FILE = path.join(ROOT_DIR, 'platform', 'integrations', 'knowledge-packs', 'product-bindings.json');
const RECOMMENDATIONS_FILE = path.join(ROOT_DIR, 'platform', 'integrations', 'knowledge-packs', 'stage-recommendations.json');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeCatalog(raw) {
  return raw && Array.isArray(raw.knowledge_packs) ? raw : { version: 1, knowledge_packs: [] };
}

function normalizeBindings(raw) {
  return raw && Array.isArray(raw.bindings) ? raw : { version: 1, bindings: [] };
}

function normalizeRecommendations(raw) {
  return raw && Array.isArray(raw.recommendations) ? raw : { version: 1, recommendations: [] };
}

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizePreset(type, value, packId) {
  if (!value) return null;
  return {
    preset_type: type,
    preset_id: value,
    preset_label: value,
    preset_source_pack_id: packId
  };
}

function normalizeRecommendation(pack, rec, stage) {
  const workflowPresets = (Array.isArray(rec.recommended_workflows) ? rec.recommended_workflows : [])
    .map((item) => normalizePreset('workflow', item, pack.id))
    .filter(Boolean);
  const skillPresets = (Array.isArray(rec.recommended_skills) ? rec.recommended_skills : [])
    .map((item) => normalizePreset('skill', item, pack.id))
    .filter(Boolean);
  const availablePresets = [...workflowPresets, ...skillPresets];
  const defaultPreset = workflowPresets[0] || skillPresets[0] || null;

  return {
    knowledge_pack_id: pack.id,
    knowledge_pack_name: pack.name,
    knowledge_pack_type: pack.type,
    repo_url: pack.repo_url,
    stage_id: stage.stage_id,
    stage_label: stage.label,
    recommended_skills: Array.isArray(rec.recommended_skills) ? rec.recommended_skills : [],
    recommended_workflows: Array.isArray(rec.recommended_workflows) ? rec.recommended_workflows : [],
    recommended_roles: Array.isArray(rec.recommended_roles) ? rec.recommended_roles : [],
    recommended_runtime_agents: Array.isArray(rec.recommended_runtime_agents) ? rec.recommended_runtime_agents : [],
    available_presets: availablePresets,
    default_preset: defaultPreset
  };
}

class KnowledgePackService {
  constructor(opts = {}) {
    this.catalogDir = opts.catalogDir || CATALOG_DIR;
    this.indexFile = opts.indexFile || INDEX_FILE;
    this.bindingsFile = opts.bindingsFile || BINDINGS_FILE;
    this.recommendationsFile = opts.recommendationsFile || RECOMMENDATIONS_FILE;
  }

  getCatalogIndex() {
    return normalizeCatalog(readJson(this.indexFile, { version: 1, knowledge_packs: [] }));
  }

  getKnowledgePacks() {
    const index = this.getCatalogIndex();
    return index.knowledge_packs.map((entry) => {
      const manifestFile = path.join(this.catalogDir, entry.manifest || `${entry.id}.pack.json`);
      const manifest = readJson(manifestFile, null);
      if (!manifest || !manifest.id) return null;
      return {
        ...manifest,
        manifest_path: path.relative(ROOT_DIR, manifestFile)
      };
    }).filter(Boolean);
  }

  getPackById(packId) {
    return this.getKnowledgePacks().find((pack) => pack.id === packId) || null;
  }

  getBindings(productId = '') {
    const data = normalizeBindings(readJson(this.bindingsFile, { version: 1, bindings: [] }));
    const bindings = productId
      ? data.bindings.filter((binding) => binding.product_id === productId)
      : data.bindings;
    return bindings.slice();
  }

  getRecommendations(packId = '') {
    const data = normalizeRecommendations(readJson(this.recommendationsFile, { version: 1, recommendations: [] }));
    const recommendations = packId
      ? data.recommendations.filter((item) => item.knowledge_pack_id === packId)
      : data.recommendations;
    return recommendations.slice();
  }

  buildProductKnowledge(product, pipeline, currentStageId = '') {
    if (!product) {
      return {
        active_packs: [],
        stage_recommendations: [],
        current_stage_id: currentStageId || '',
        current_stage_recommendations: [],
        summary: { active_packs: 0, current_stage_recommendations: 0, active_pack_names: [] }
      };
    }

    const allPacks = this.getKnowledgePacks();
    const packById = allPacks.reduce((acc, pack) => {
      acc[pack.id] = pack;
      return acc;
    }, {});

    const activeBindings = this.getBindings(product.product_id).filter((binding) => binding.enabled !== false);
    const activePacks = activeBindings.map((binding) => {
      const pack = packById[binding.knowledge_pack_id];
      if (!pack) return null;
      return {
        ...pack,
        binding: {
          product_id: binding.product_id,
          knowledge_pack_id: binding.knowledge_pack_id,
          enabled: binding.enabled !== false,
          notes: binding.notes || ''
        }
      };
    }).filter(Boolean);

    const recommendations = this.getRecommendations();
    const stageRecommendations = (pipeline || []).map((stage) => {
      const entries = activePacks
        .map((pack) => {
          const rec = recommendations.find((item) => item.knowledge_pack_id === pack.id && item.stage_id === stage.stage_id);
          if (!rec) return null;
          return normalizeRecommendation(pack, rec, stage);
        })
        .filter(Boolean);

      return {
        stage_id: stage.stage_id,
        label: stage.label,
        status: stage.status,
        is_current: stage.stage_id === currentStageId,
        knowledge_pack_ids: dedupe(entries.map((entry) => entry.knowledge_pack_id)),
        available_presets: entries.flatMap((entry) => (entry.available_presets || []).map((preset) => ({
          ...preset,
          knowledge_pack_id: entry.knowledge_pack_id,
          knowledge_pack_name: entry.knowledge_pack_name
        }))),
        default_preset: (() => {
          const selected = entries.find((entry) => entry.default_preset)?.default_preset;
          if (!selected) return null;
          const owner = entries.find((entry) => entry.knowledge_pack_id === selected.preset_source_pack_id);
          return {
            ...selected,
            knowledge_pack_id: owner ? owner.knowledge_pack_id : selected.preset_source_pack_id,
            knowledge_pack_name: owner ? owner.knowledge_pack_name : selected.preset_source_pack_id
          };
        })(),
        recommendations: entries
      };
    });

    const currentStage = stageRecommendations.find((item) => item.stage_id === currentStageId) || null;

    return {
      active_packs: activePacks,
      stage_recommendations: stageRecommendations,
      current_stage_id: currentStageId || '',
      current_stage_recommendations: currentStage ? currentStage.recommendations : [],
      summary: {
        active_packs: activePacks.length,
        current_stage_recommendations: currentStage ? currentStage.recommendations.length : 0,
        active_pack_names: activePacks.map((pack) => pack.name)
      }
    };
  }
}

let instance = null;

function getKnowledgePackService() {
  if (!instance) instance = new KnowledgePackService();
  return instance;
}

module.exports = {
  KnowledgePackService,
  getKnowledgePackService
};
