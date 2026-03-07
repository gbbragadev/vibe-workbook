# Current Workspace Inventory

Inventario inicial produzido na Fase 0/1 para mapear o estado legado do runtime sem alterar seu funcionamento.

## Source Files Used

- `state/workspaces.json`
- `state/config.json`

## Workspace To Product Mapping

| Workspace ID | Workspace Name | Current Working Dir | Proposed Product ID | Classification | Path Status | Notes |
|---|---|---|---|---|---|---|
| `ws-bf903de8` | `CamZap` | `` | `zapcam` | duplicate-workspace | `unknown` | workspace sem `workingDir`; consolidado como duplicidade operacional de `zapcam` |
| `ws-634fa99c` | `Projeto ZapCam` | `C:\Users\guibr\myrlin-workbook` | `zapcam` | product | `mismatched` | path existe, mas e o repo do Myrlin Workbook; repo local final consolidado: `C:\Users\guibr\ZapCam` |
| `ws-010ce800` | `Projeto Ronda X` | `C:\Users\guibr\Documents\.Organizados-Projetos-ronda-x-veiculos` | `rondax` | product | `invalid` | path do workspace nao existe; repo local final consolidado: `C:\Users\guibr\Documents\_Organizados\Projetos\ronda-x-veiculos` |
| `ws-6b23ebad` | `Agente LSP` | `C:\Users\guibr\Documents\.Organizados-Projetos-Guilherme-Projetos-lsp-agent-v3-lsp-agent` | `lsp-agent-v3` | internal-tool | `invalid` | path do workspace nao existe; repo local final consolidado: `C:\Users\guibr\Documents\_Organizados\Projetos\Guilherme_Projetos\lsp-agent-v3\lsp-agent` |

## Session Notes

- `sess-9a6cbc1c` referencia `zapcam` e possui `resumeSessionId` Claude definido.
- `sess-c2722c65` referencia `rondax`.
- `sess-de43175e` referencia `lsp-agent-v3`.

## Governance Inconsistencies

- duplicidade entre `CamZap` e `ZapCam` foi consolidada como um unico produto `zapcam`
- paths legados usam convencoes antigas e nao representam taxonomia alvo
- `state/config.json` usa senha em texto puro
- `state/config.json` aponta `claudeProjects` para path Unix em ambiente Windows

## Rule Adopted In Phase 0/1

Nenhuma dessas inconsistencias sera corrigida diretamente no runtime nesta etapa. Todas ficam registradas para saneamento posterior sem quebrar o app atual.
