# Workspace Governance Policy

## Workspace Definition

Nesta fase, workspace e uma entidade operacional do app atual. Ele nao substitui a entidade de produto.

## Mapping Rule

Todo workspace relevante deve estar em uma destas situacoes:

- mapeado para um produto
- classificado como item interno
- classificado como duplicidade operacional de produto existente
- marcado como pendente de classificacao

## Path Status Rule

Todo path de workspace deve ser classificado como:

- `valid`
- `invalid`
- `mismatched`
- `unknown`

## Classification Rule

- `valid`: path atual do workspace corresponde ao repo local consolidado do item
- `invalid`: path atual do workspace nao existe
- `mismatched`: path atual existe, mas aponta para outro repositorio ou contexto
- `unknown`: nao ha path suficiente para consolidacao

## Current Constraints

- nao alterar `state/workspaces.json` nesta fase
- nao inferir governanca apenas pelo nome do workspace
- registrar conflitos e duplicidades explicitamente
