# Workspace Structure

## Official Directory Tree

```text
vibe-workbook/
├── platform/
│   ├── docs/
│   ├── catalog/
│   │   ├── agents/
│   │   └── policies/
│   └── templates/
├── products/
│   └── registry/
├── archive/
│   ├── legacy-project-maps/
│   └── deprecated-notes/
├── src/
├── state/
├── README.md
├── PROJECT-SUMMARY.md
└── package.json
```

## Allowed Contents By Directory

### `platform/docs/`

- arquitetura da plataforma
- regras de workspace
- contrato de agentes
- template padrao de produto

### `platform/catalog/agents/`

- catalogo de agentes suportados
- papeis e handoffs

### `platform/catalog/policies/`

- politicas de governanca
- regras de localizacao
- criterios minimos de cadastro de produto

### `platform/templates/`

- estrutura minima de um produto
- arquivos markdown e manifesto padrao

### `products/registry/`

- registry manual dos produtos conhecidos
- inventario inicial de governanca

### `archive/`

- material legado
- notas deprecated
- mapeamentos antigos que nao devem orientar novas decisoes

### `src/` e `state/`

- runtime legado do app atual
- nao usar como referencia de governanca de produto

## Forbidden Patterns

- codigo principal de produto dentro do hub
- novo produto sem `product_id`
- produto sem owner
- produto sem path registrado
- usar `state/workspaces.json` como catalogo oficial de produtos
- criar documentacao nova dentro de `state/`

## Legacy State Rules

- `state/workspaces.json` continua sendo a fonte operacional do app.
- `state/config.json` continua sendo config operacional legado.
- nenhuma politica nova deve depender de alterar esses arquivos nesta fase.

## Archive Rules

- nada vai para `archive/` sem motivo escrito
- archive nao e lixeira
- archive preserva contexto, mas nao dita a arquitetura-alvo

## Naming Conventions

- `product_id`: ascii, lowercase, kebab-case
- `slug`: igual ao `product_id` por padrao
- `stage`: `idea`, `discovery`, `build`, `staging`, `production`, `maintenance`
- `status`: `active`, `paused`, `archived`
- `category`: `product`, `internal-tool`, `experiment`
- `path_status`: `valid`, `invalid`, `mismatched`, `unknown`

## Practical Examples

- `Zapcam` deve existir no registry como `product_id: zapcam`.
- O workspace legado `ws-634fa99c` continua operacional, mas seu path esta marcado como `mismatched` porque aponta para outro repo existente.
- `CamZap` nao deve permanecer como produto separado no registry; ele foi consolidado como duplicidade operacional de `zapcam`.
