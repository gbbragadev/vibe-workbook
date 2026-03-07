# Product Governance Policy

## Minimum Product Record

Todo produto precisa ter:

- `product_id`
- `name`
- `owner`
- `stage`
- `status`
- `category`
- `repo.local_path`

## Category Rule

- `product`: produto entregue a usuario ou cliente
- `internal-tool`: ferramenta interna de apoio operacional ou tecnico
- `experiment`: item ainda nao consolidado como produto ou ferramenta interna

## Required Registration

- produto conhecido deve existir em `products/registry/products.json`
- se o repo proprio ainda nao existir, isso deve ser explicitado
- status do path do workspace deve ser marcado como `valid`, `invalid`, `mismatched` ou `unknown`

## Duplicate Handling

- duplicidade de workspace nao cria produto novo automaticamente
- quando dois workspaces apontam para o mesmo produto, apenas um produto permanece no registry
- a duplicidade operacional deve ser registrada no inventario legado

## Source Of Truth

- registry do hub = governanca inicial
- repo do produto = fonte do codigo do produto
- runtime legado = operacao de sessoes

## Disallowed

- produto ativo sem owner
- produto sem classificacao
- produto misturado ao hub sem justificativa
