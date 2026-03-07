# Product Template

## Minimum Required Structure

```text
<product-repo>/
├── README.md
├── PRODUCT.md
├── ARCHITECTURE.md
├── ADR/
├── docs/
│   ├── spec.md
│   ├── runbook.md
│   ├── test-strategy.md
│   └── release-plan.md
└── .platform/
    └── product.json
```

## Required Files

- `README.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `docs/spec.md`
- `docs/runbook.md`
- `docs/test-strategy.md`
- `docs/release-plan.md`
- `.platform/product.json`

## Manifest Contract

`.platform/product.json` deve registrar no minimo:

- `product_id`
- `name`
- `slug`
- `owner`
- `stage`
- `status`
- `repository.local_path`
- `paths.spec`
- `paths.runbook`

## Onboarding Checklist

- produto cadastrado em `products/registry/products.json`
- `product_id` definido
- owner definido
- repo local conhecido
- stage definido
- manifesto `.platform/product.json` presente ou planejado
- docs minimos previstos

## Required Now vs Later

### Obrigatorio agora

- manifesto do produto
- spec
- runbook
- estrategia de testes
- plano de release

### Desejavel depois

- dashboards
- metrics avancadas
- postmortems
- playbooks automatizados

## Example

`Zapcam` deve ser criado como repo proprio, com `.platform/product.json` e `docs/` padronizado. Enquanto isso nao existir, o registro no hub continua sendo a fonte inicial de governanca.
