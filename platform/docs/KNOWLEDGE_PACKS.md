# Knowledge Packs

## Purpose

Knowledge Packs enrich products with curated external knowledge sources without turning them into runtime dependencies.

The platform starts in `reference-first` mode:

- the pack is registered in the hub;
- the product can be linked to the pack;
- stage recommendations are exposed in Product UX;
- no installation or sync with the external repository is required.

## Current Structure

- `platform/catalog/knowledge-packs/`
  Stores pack manifests curated by the platform.
- `platform/integrations/knowledge-packs/`
  Stores product bindings and stage recommendations.

## Current Official Pack

- `pm-skills`
  - source: GitHub
  - repo: `https://github.com/phuryn/pm-skills`
  - type: `skills-pack`
  - integration mode: `reference-first`

## Integration Rules

- knowledge packs must remain optional
- missing catalog files must not break the app
- product UX may surface pack guidance, but runtime execution stays unchanged
- stage recommendations are curated internally and versioned in this repository
