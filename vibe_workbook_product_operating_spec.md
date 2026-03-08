# Vibe Workbook — Documento Mestre de Produto, Execução e Definition of Done

## 1. Resumo executivo

O Vibe Workbook existe para sair do modo "terminal solto + prompts desconectados" e virar um **cockpit pessoal de criação, validação e evolução de produtos**. O objetivo não é só organizar tarefas. O objetivo é **ajudar o criador a transformar ideias em produtos reais, testáveis e monetizáveis**, com contexto, continuidade, evidência e incremento constante.

Neste momento, o produto já possui sinais claros de maturidade em infraestrutura e coordenação de fluxo, mas ainda precisa endurecer a camada de verdade operacional. A prioridade não é adicionar mais brilho visual. A prioridade é fazer com que a interface e os estados internos comuniquem apenas o que o sistema realmente sabe e consegue sustentar.

Este documento define:
- a visão real do produto;
- o papel do Vibe Workbook na geração de renda extra;
- o que ele já é e o que ainda não é;
- os princípios de produto e de operação;
- Definition of Done realista por estágio;
- critérios de validação para agentes autônomos;
- limites, guardrails e próximos focos.

---

## 2. Contexto e intenção real do produto

### 2.1. Motivação principal
O Vibe Workbook não está sendo construído como um SaaS genérico primeiro. Ele está sendo construído como uma **fábrica pessoal de produtos**.

O problema a resolver é simples e brutal:
- muitas ideias morrem em execução fragmentada;
- o trabalho com IA acelera criação, mas também espalha contexto;
- o criador precisa de um lugar que conecte ideia, artefato, estado, decisão e evolução;
- esse lugar precisa permitir criar produtos que possam gerar **renda extra**, sem depender de memória manual e sem transformar tudo em caos de prompts.

### 2.2. Missão
Permitir que um operador solo use agentes, contexto e workflow para **conceber, especificar, implementar, testar, lançar e melhorar produtos pequenos e médios com cadência consistente**.

### 2.3. Resultado esperado
O Vibe Workbook deve reduzir a distância entre:
- ideia e primeira versão utilizável;
- primeira versão e produto vendável;
- produto vendável e rotina de melhoria contínua.

---

## 3. Tese de produto

### 3.1. Tese central
O Vibe Workbook deve se comportar como um **cockpit pessoal de delivery assistido por agentes**, onde o criador consegue:
- iniciar um produto novo com contexto útil;
- avançar por estágios claros;
- manter artefatos e decisões ligados ao produto;
- validar o que realmente foi feito;
- retomar trabalho semanas depois sem cair no limbo mental;
- usar agentes para implementar, testar e refinar sem perder o fio da meada.

### 3.2. Tese econômica
O valor do Vibe Workbook não está só em organizar software. O valor está em **aumentar a taxa de criação de produtos com potencial de receita**.

Em termos práticos, ele deve ajudar o criador a:
- testar oportunidades mais rápido;
- transformar ideias em produtos menores e lançáveis;
- reduzir retrabalho causado por contexto perdido;
- manter melhoria contínua mesmo com várias iniciativas paralelas;
- priorizar produtos com melhor relação entre esforço, tempo e potencial de retorno.

---

## 4. O que o produto já é

Com base no estado atual descrito, o Vibe Workbook já é:
- uma base operacional com workspaces, sessões, PTY e múltiplos runtimes;
- uma camada de produto com pipeline por estágio, current run, handoffs, readiness, next actions e product detail;
- um sistema que já tenta interpretar trabalho em vez de apenas abrir terminais;
- um ambiente em que artifacts, execução e progresso já começam a ser relacionados;
- uma plataforma pessoal promissora para uso diário de construção assistida por IA.

---

## 5. O que o produto ainda não é

O Vibe Workbook ainda não deve ser tratado como:
- um cockpit totalmente confiável de entrega com garantias fortes;
- um sistema que prova qualidade semântica só porque mostra estados verdes;
- um mecanismo de workflow rígido e auditável em nível enterprise;
- um rollback ambiental completo;
- um sistema que já valida profundamente a qualidade do que foi produzido.

Em linguagem direta: ele já é útil, mas ainda precisa endurecer a honestidade dos seus sinais.

---

## 6. Papel do Vibe Workbook na estratégia de renda extra

O Vibe Workbook não é o produto final que necessariamente gera renda. Ele é a **máquina de produzir, iterar e operar produtos**.

### 6.1. Funções estratégicas
Ele deve servir para:
- organizar produtos com potencial de monetização;
- reduzir o custo cognitivo de tocar vários produtos pequenos;
- permitir que agentes façam parte da construção com menos perda de contexto;
- estruturar testes, handoffs e checkpoints;
- acelerar o ciclo ideia → validação → lançamento → melhoria.

### 6.2. Tipos de produto-alvo
Os produtos que o Vibe Workbook deve ajudar a gerar tendem a ser:
- micro-SaaS;
- ferramentas internas transformáveis em produto;
- automações vendáveis;
- apps simples com proposta clara;
- assistentes verticais;
- painéis, serviços ou utilitários com nicho bem definido.

### 6.3. Métrica econômica principal
A principal pergunta de negócio do Vibe Workbook não é “quantas features ele tem?”.

A principal pergunta é:

**ele está aumentando a capacidade do criador de lançar produtos úteis, pequenos e rentáveis com menos atrito e menos esquecimento?**

---

## 7. Usuário-alvo

### 7.1. Usuário principal
Um único criador / operador solo que:
- tem várias ideias e projetos;
- trabalha com agentes de IA;
- precisa de continuidade entre sessões;
- quer transformar trabalho técnico em produtos de verdade;
- quer aumentar a chance de renda extra por meio de produtos incrementais.

### 7.2. Implicações disso
Como o uso principal é solo:
- a clareza semântica é mais importante do que robustez enterprise imediata;
- a UI não pode enganar o próprio criador;
- o sistema deve privilegiar retomada de contexto, foco e confiabilidade local;
- não é necessário otimizar tudo para multiusuário já;
- mas dívidas técnicas estruturais relevantes devem ser mapeadas cedo.

---

## 8. Princípios de produto

1. **A interface não pode prometer mais do que o core garante.**
2. **Existência de arquivo não é sinônimo de entrega válida.**
3. **Estágio concluído exige evento formal, não só efeito colateral no disco.**
4. **Handoff deve transferir contexto utilizável, não só uma etiqueta bonita.**
5. **O sistema deve priorizar retomada confiável de contexto.**
6. **Automação deve reduzir trabalho mental, não mascarar incerteza.**
7. **O produto deve ajudar a lançar coisas reais, não só organizar atividade.**
8. **O agente autônomo deve operar com escopo pequeno, ciclos curtos e validação explícita.**
9. **A menor correção viável é preferível ao refactor barroco.**
10. **A definição de pronto precisa ser aplicável na vida real, não ritual corporativo.**

---

## 9. Estado atual resumido em camadas

### 9.1. Camada operacional
Já suporta workspaces, terminais, sessões e infraestrutura básica para execução.

### 9.2. Camada de produto
Já possui products overview, product detail, pipeline por estágio, current run, handoffs e next actions.

### 9.3. Camada semântica
Já começou a existir via orquestração de execução, evidência e leitura mais útil do estado.

### 9.4. Camada de segurança e controle
Já aponta na direção de checkpoint e rollback, mas ainda não deve vender segurança além do escopo real.

---

## 10. Problemas principais a resolver agora

### 10.1. Honestidade semântica insuficiente
A UI e os estados derivados podem comunicar maturidade ou conclusão acima do que o sistema validou de fato.

### 10.2. Progressão fraca de pipeline
Um estágio não pode ser considerado concluído apenas porque artefatos apareceram no disco.

### 10.3. Readiness superficial
Readiness não pode ser “forte” só porque um arquivo existe.

### 10.4. Contexto insuficiente entre handoffs
Resumos curtos demais podem prejudicar a continuidade de execução entre fases.

### 10.5. Persistência e custo de leitura
Para o uso atual, o modelo ainda pode servir. Mas o sistema precisa mapear cedo onde a arquitetura de estado local começará a cobrar pedágio.

---

## 11. North Star do produto

### 11.1. North Star funcional
**Conseguir iniciar, evoluir, retomar e lançar produtos com ajuda de agentes, mantendo contexto e critérios mínimos de verdade operacional.**

### 11.2. North Star econômica
**Usar o Vibe Workbook para aumentar a taxa de produtos pequenos que chegam a uma versão lançável e potencialmente rentável.**

### 11.3. Sinal de sucesso real
O produto está indo bem quando:
- o criador confia na leitura de estado sem precisar reauditar tudo manualmente;
- agentes conseguem continuar trabalho com menos perda de contexto;
- produtos saem do limbo e chegam a lançamentos pequenos e concretos;
- a ferramenta reduz retrabalho e acelera a iteração útil.

---

## 12. Metas do produto

### 12.1. Metas de curto prazo
- fazer pipeline e readiness comunicarem apenas o que realmente foi validado;
- melhorar handoffs para carregarem contexto aproveitável;
- tornar criação e retomada de produtos mais confiáveis;
- aumentar a previsibilidade do fluxo de execução assistida.

### 12.2. Metas de médio prazo
- transformar o Vibe em uma rotina diária confiável de construção de produtos;
- padronizar ciclos de validação e correção com agentes;
- fortalecer o elo entre artifacts, runs, handoffs e estado do produto.

### 12.3. Metas de longo prazo
- permitir um portfólio pessoal de produtos organizados, mantidos e evoluídos no mesmo cockpit;
- apoiar geração recorrente de renda extra com produtos menores, iteráveis e bem acompanhados.

---

## 13. Não-objetivos por enquanto

Não é prioridade agora:
- virar plataforma enterprise multiusuário;
- resolver sandboxing absoluto de infraestrutura;
- construir workflow formal gigantesco com dezenas de estados sofisticados;
- adicionar mais telas antes de endurecer semântica;
- implantar arquitetura supercomplexa só por elegância.

---

## 14. Modelo operacional do produto

### 14.1. Fluxo desejado
1. Ideia / oportunidade
2. Product creation
3. Brief / spec
4. Architecture
5. Implementation
6. Test / QA
7. Release / launch
8. Operate / iterate

### 14.2. Função do agente autônomo
O agente autônomo existe para:
- testar fluxos reais;
- identificar falhas reproduzíveis;
- acionar correções pequenas e localizadas;
- validar regressões;
- continuar incrementando o produto sem perder o contexto principal.

### 14.3. Regra de ouro do agente
**Um bug por vez.**

O agente não deve:
- agrupar bugs não relacionados numa só intervenção;
- reestruturar o sistema inteiro sem necessidade;
- interpretar UI verde como prova semântica suficiente;
- fazer redesign amplo sob pretexto de corrigir falha pontual.

---

## 15. Fluxos críticos que precisam funcionar bem

1. Criar Project
2. Criar / gerar Product
3. Navegar Product Overview / Product Detail
4. Pipeline por estágio
5. Current Run
6. Handoffs
7. Readiness
8. Next Actions
9. Retomada de execução
10. Revalidação após correção

Esses fluxos são mais importantes do que polimento visual periférico.

---

## 16. Definition of Done global do Vibe Workbook

Uma melhoria só deve ser considerada concluída quando cumprir todos os critérios abaixo:

1. **Resolve um problema real do fluxo principal** ou melhora claramente a confiabilidade semântica.
2. **Pode ser explicada de forma simples**: o que mudou, em qual arquivo, e qual impacto teve.
3. **Não amplia desnecessariamente o escopo** do sistema.
4. **Não comunica na UI mais do que o backend consegue sustentar.**
5. **Passa por validação prática**, preferencialmente no fluxo real da interface.
6. **Não cria regressão visível** no fluxo imediatamente vizinho.
7. **Fica rastreável** por commit, diff e descrição do impacto.

Se uma mudança apenas “parece boa”, mas não melhora verdade operacional, ela não está done.

---

## 17. Definition of Done por estágio do produto

### 17.1. Estágio: Opportunity / Brief
**Objetivo:** tornar a oportunidade clara o suficiente para decidir se vale investir.

**Done quando:**
- problema e público-alvo estão descritos com clareza;
- existe hipótese de valor;
- existe hipótese inicial de monetização;
- está claro por que este produto vale ser perseguido agora;
- existe critério de sucesso inicial.

**Não está done se:**
- é só ideia vaga;
- não há recorte de usuário;
- não há noção de dor, utilidade ou potencial de receita;
- só existe entusiasmo genérico.

### 17.2. Estágio: Spec
**Objetivo:** definir o que será construído na primeira versão útil.

**Done quando:**
- o escopo da v1 está delimitado;
- os fluxos principais de uso estão descritos;
- o que fica fora da v1 também está explícito;
- os requisitos principais foram escritos com clareza suficiente para implementação;
- existe artefato de spec minimamente preenchido, revisado e handoff formal do estágio.

**Não está done se:**
- o documento existe mas está vazio ou esquelético;
- há só tópicos genéricos sem decisões;
- não há clareza sobre a primeira versão lançável.

### 17.3. Estágio: Architecture
**Objetivo:** deixar claro como a v1 será implementada de forma suficiente para execução.

**Done quando:**
- a arquitetura da v1 está descrita em nível compatível com implementação;
- serviços, componentes, entidades ou integrações principais estão definidos;
- riscos e simplificações estão explícitos;
- há artefato de arquitetura com conteúdo real e handoff formal do estágio.

**Não está done se:**
- o arquivo existe mas não orienta construção;
- não há decisões sobre estrutura básica;
- há só boilerplate bonito.

### 17.4. Estágio: Implementation
**Objetivo:** produzir a primeira versão funcional do que foi especificado.

**Done quando:**
- o fluxo principal da v1 funciona ponta a ponta;
- a implementação corresponde ao escopo real da versão atual;
- os principais bugs bloqueantes foram tratados;
- o código foi integrado ao produto existente sem regressão evidente;
- há handoff formal de implementação.

**Não está done se:**
- só existem componentes soltos;
- o fluxo principal ainda não fecha;
- a UI parece pronta, mas a ação falha;
- a feature não foi validada em uso real.

### 17.5. Estágio: Test / QA
**Objetivo:** reduzir risco de erro visível no uso real.

**Done quando:**
- existe teste prático do fluxo principal;
- bugs críticos do fluxo validado foram corrigidos ou explicitamente aceitos;
- a semântica da UI não comunica sucesso onde não houve validação;
- existe evidência real de teste, não apenas presença de arquivo;
- há handoff formal do estágio.

**Não está done se:**
- o “teste” é só um documento vazio;
- não houve validação E2E mínima;
- não há clareza do que foi exercitado.

### 17.6. Estágio: Release
**Objetivo:** tornar o produto lançável com risco aceitável para a fase atual.

**Done quando:**
- existe uma versão pequena porém utilizável;
- o fluxo principal está operacional;
- bugs bloqueantes conhecidos não impedem uso básico;
- a proposta de valor da versão está clara;
- há plano mínimo de lançamento ou uso.

**Não está done se:**
- só existe sensação de progresso;
- o produto ainda depende de interpretação benevolente;
- o sistema marca readiness verde por artefato vazio.

### 17.7. Estágio: Operate / Iterate
**Objetivo:** permitir evolução contínua e organizada do produto.

**Done quando:**
- existe backlog claro de melhorias reais;
- os problemas encontrados em uso viram tarefas rastreáveis;
- os próximos passos são escolhidos por impacto, não por impulso;
- o histórico do produto permite retomada sem sofrimento.

---

## 18. Definition of Done específica para o próprio Vibe Workbook

Quando o Vibe Workbook evolui, a mudança só deve ser considerada pronta se:
- melhorar a confiabilidade de um fluxo central;
- ou melhorar a continuidade entre estágios;
- ou reduzir autoengano na leitura de estado;
- ou acelerar a criação/retomada de produtos reais;
- ou diminuir a fricção para testar, corrigir e relançar.

Mudança não está pronta se apenas:
- adiciona uma aba nova;
- melhora a aparência sem aumentar a verdade operacional;
- cria mais ceremony sem reduzir ambiguidade;
- amplia o discurso do sistema sem melhorar seus contratos.

---

## 19. Critérios reais de evidência

### 19.1. Evidência fraca
- arquivo existe;
- campo foi preenchido;
- label foi gerada;
- estágio foi clicado.

### 19.2. Evidência média
- arquivo existe e tem conteúdo mínimo plausível;
- o fluxo correspondente foi exercitado parcialmente;
- o artefato ajuda de fato a fase seguinte.

### 19.3. Evidência forte
- fluxo foi validado de forma reproduzível;
- artefato tem conteúdo utilizável;
- a fase seguinte consegue operar com o handoff recebido;
- a UI e o core contam a mesma história.

O sistema deve evitar chamar evidência fraca de “forte”.

---

## 20. Metas e KPIs do produto

### 20.1. KPIs de utilidade
- tempo para criar um novo produto organizadamente;
- tempo para retomar um produto parado;
- tempo entre ideia e primeira validação funcional;
- número de bugs críticos detectados e corrigidos via loop autônomo.

### 20.2. KPIs de confiabilidade
- quantos estados verdes correspondem a validação real;
- número de falsos positivos de readiness;
- número de regressões visíveis após correções;
- taxa de handoffs que realmente servem para a fase seguinte.

### 20.3. KPIs de valor econômico
- número de produtos que chegam a versão lançável;
- número de produtos em teste com usuários reais;
- número de produtos com primeira receita;
- tempo médio entre ideia e “produto minimamente vendável”.

---

## 21. Priorização de iniciativas

Quando houver disputa entre tarefas, priorizar nesta ordem:

1. Bugs que impedem criação de Project
2. Bugs que impedem criação / geração de Product
3. Bugs que quebram pipeline, current run, handoff ou readiness
4. Bugs que induzem confiança falsa
5. Melhorias que reduzem contexto perdido entre fases
6. Melhorias que aceleram teste, correção e revalidação
7. Polimento visual

---

## 22. Guia de operação do agente autônomo

### 22.1. Papel do agente
Testar o sistema como usuário real, registrar falhas reproduzíveis, acionar correções pequenas e revalidar.

### 22.2. Loop esperado
1. Abrir a aplicação no navegador
2. Testar fluxo prioritário
3. Registrar bug reproduzível
4. Acionar executor de código para corrigir um bug por vez
5. Revalidar o mesmo fluxo
6. Confirmar ausência de regressão próxima
7. Repetir

### 22.3. Regras obrigatórias
- um bug por vez;
- preservar arquitetura existente;
- não fazer refactor amplo;
- não inventar estrutura nova;
- não confundir bug visual pequeno com falha de fluxo crítico;
- não considerar fix sem revalidação.

### 22.4. Critério de aceite do agente
Uma correção só conta como válida se:
- o bug original ficou reproduzivelmente corrigido;
- o fluxo principal relacionado passou;
- a correção foi rastreada por commit;
- não houve regressão visível no entorno imediato.

---

## 23. Guardrails para evolução do produto

1. Não adicionar mais inteligência aparente do que inteligência real.
2. Não usar nomes grandiosos para mecanismos frágeis.
3. Não marcar como done aquilo que só está detectado.
4. Não usar arquivo vazio como prova de maturidade.
5. Não deixar handoff virar telefone sem fio.
6. Não deixar o agente corrigir múltiplos bugs não relacionados na mesma tacada.
7. Não deixar mudanças em UI/UX se divorciarem do modelo real.

---

## 24. Backlog estratégico recomendado

### 24.1. Primeiro bloco: honestidade semântica
- stage done depender de handoff formal;
- estado intermediário como ready-for-handoff;
- readiness distinguir arquivo ausente, vazio e válido;
- tornar UI honesta sobre escopo do rollback.

### 24.2. Segundo bloco: continuidade de contexto
- incluir artefatos referenciados no bootstrap da fase seguinte;
- melhorar estrutura do handoff;
- reduzir perda de contexto entre etapas.

### 24.3. Terceiro bloco: robustez operacional
- reduzir recomputação pesada em leitura;
- melhorar persistência e estratégia de estado;
- fortalecer a ergonomia do ciclo teste → correção → validação.

### 24.4. Quarto bloco: suporte à monetização
- templates de novos produtos com hipóteses de monetização;
- campos de ICP, dor, valor e pricing inicial;
- checklist de lançabilidade;
- visão de portfólio e prioridade por potencial de retorno.

---

## 25. Checklist de produto monetizável

Ao criar um novo produto no Vibe Workbook, o sistema deve orientar para que cada produto responda pelo menos:
- qual problema resolve;
- para quem resolve;
- por que alguém pagaria por isso;
- qual a menor versão útil vendável;
- como será validado rápido;
- qual métrica indicará tração inicial;
- qual será o canal inicial de aquisição;
- qual é a hipótese de preço.

Se isso não existir, o produto ainda pode ser exploratório, mas não deve ser tratado como pronto para lançamento.

---

## 26. Critérios de lançamento real

Um produto criado com ajuda do Vibe Workbook só deve ser tratado como lançável quando:
- a proposta de valor estiver clara;
- o fluxo principal estiver funcionando;
- os bugs mais graves conhecidos estiverem controlados;
- o produto tiver escopo pequeno porém coerente;
- existir pelo menos um caminho prático para colocá-lo diante de usuários ou compradores.

---

## 27. Riscos a evitar

- acreditar que organização é o mesmo que entrega;
- confundir artifact com qualidade;
- confundir summary com contexto suficiente;
- confundir status verde com segurança real;
- cair na tentação de expandir o cockpit antes de consolidar a cabine.

---

## 28. Veredito de produto

O Vibe Workbook deve ser guiado por esta ambição concreta:

**ser a ferramenta pessoal que permite ao criador conceber, construir, testar, lançar e iterar produtos monetizáveis com ajuda de agentes, sem perder o contexto e sem ser enganado pelos próprios dashboards.**

Se ele fizer isso, já terá vencido uma guerra importante.

Se ele apenas parecer sofisticado, mas continuar exigindo reauditoria mental de tudo, será só mais um painel bonito tentando convencer o operador de que a nave está sob controle.

---

## 29. Próxima orientação para agentes autônomos

Toda atuação futura de agente deve obedecer esta ordem:

1. proteger a honestidade semântica do sistema;
2. validar fluxos reais no navegador;
3. corrigir um bug por vez;
4. revalidar antes de avançar;
5. priorizar o que aumenta confiança e reduz retrabalho;
6. só depois expandir capacidades visuais ou camadas adicionais.

Esse é o rumo correto do Vibe Workbook no cenário atual.

---

## 30. Governança de uso de modelos e sessões

O Vibe Workbook deve tratar modelos e agentes como recursos operacionais com funções específicas, custo implícito e janela de contexto limitada. O sistema não deve usar qualquer modelo para qualquer tarefa. A escolha do modelo deve obedecer ao tipo de trabalho.

### 30.1. Objetivo desta camada

Permitir que o operador escolha conscientemente qual motor usar em cada etapa, preservando:
- contexto útil;
- custo/limite de uso;
- velocidade;
- qualidade da saída;
- separação de papéis.

### 30.2. Princípio central

**Modelo bom não é o mais poderoso sempre; é o mais adequado à tarefa atual.**

### 30.3. Papéis recomendados por modelo

#### Claude / Anthropic
Usar preferencialmente para:
- leitura profunda de contexto;
- planejamento longo;
- revisão de produto e arquitetura;
- consolidação de documentação;
- raciocínio em textos extensos;
- sessões de continuidade semanal.

#### Codex
Usar preferencialmente para:
- implementação local no repositório;
- correções cirúrgicas;
- geração de diffs pequenos e verificáveis;
- execução de checks;
- commit e push;
- trabalho focado em bug atual.

#### Gemini
Usar preferencialmente para:
- orquestração de testes;
- navegação no navegador;
- validação E2E;
- triagem de bugs;
- exploração de fluxos;
- coordenação entre validação e executor de código.

#### Antigravity
Quando disponível novamente, usar preferencialmente para:
- tarefas longas autônomas;
- browser automation;
- loops de teste/correção;
- observação de fluxo real;
- trabalho contínuo de auditoria.

### 30.4. Regra de separação de papéis

- quem testa não deve carregar o repositório inteiro sem necessidade;
- quem corrige não deve carregar toda a exploração de navegador sem necessidade;
- quem consolida estratégia/documentação não deve ficar poluído por logs operacionais demais;
- o sistema deve evitar uma única sessão monolítica para tudo.

### 30.5. Sessões semanais de continuidade

O Vibe Workbook deve suportar uma visão de “sessão semanal” para uso com Claude/Anthropic, onde o operador consiga:
- ver o resumo da semana do produto;
- ver decisões tomadas;
- ver bugs corrigidos;
- ver blockers restantes;
- ver próximos passos recomendados;
- retomar o produto sem reler o mundo inteiro.

### 30.6. Definition of Done desta camada

Esta camada só está pronta quando:
- os papéis dos modelos estiverem claros;
- o operador souber qual modelo usar para qual tipo de trabalho;
- o sistema reduzir contexto desnecessário em cada agente;
- o fluxo de trabalho entre modelos ficar mais previsível e menos caótico.

---

## 31. Sessão de Ideias e Arsenal de Produtos

O Vibe Workbook deve possuir uma área própria de **Ideias**, dedicada não apenas a anotar inspirações, mas a construir um motor contínuo de descoberta, filtragem e priorização de oportunidades de produto.

### 31.1. Objetivo

Criar um **arsenal de oportunidades de produto** a partir de sinais reais do mercado, comunidades e dores recorrentes, para que o operador tenha uma esteira contínua de possibilidades monetizáveis.

### 31.2. Fontes possíveis

A camada de Ideias pode capturar sinais de:
- Reddit;
- X / Twitter;
- Google / web aberta;
- fóruns e comunidades especializadas;
- marketplaces e diretórios de produtos;
- comentários em vídeos, newsletters ou threads;
- tendências e anomalias observadas por scraping.

### 31.3. Princípio

**Ideia bruta não basta. O sistema deve transformar ruído em oportunidade estruturada.**

### 31.4. Estrutura recomendada para cada ideia

Cada ideia do arsenal deve ter pelo menos:
- título curto;
- problema percebido;
- tipo de usuário afetado;
- intensidade da dor;
- frequência da dor;
- sinais coletados (posts, comentários, links, prints ou citações curtas);
- hipótese de produto;
- hipótese de monetização;
- velocidade estimada de execução;
- vantagem pessoal do operador para construir isso;
- score de atratividade.

### 31.5. Pipeline da sessão de Ideias

1. Coletar sinais via scraping ou pesquisa
2. Agrupar sinais semelhantes
3. Identificar padrões de dor, frustração, desejo ou workaround
4. Transformar padrão em hipótese de produto
5. Filtrar por potencial real para o operador
6. Priorizar por combinação de:
   - facilidade de execução
   - recorrência da dor
   - urgência percebida
   - monetização plausível
   - aderência às capacidades do criador

### 31.6. Modos de operação

#### Modo exploratório
Buscar ideias diferentes, estranhas, nichadas ou subatendidas.

#### Modo tendências
Buscar temas que estejam ganhando volume, recorrência ou aceleração recente.

#### Modo dores recorrentes
Buscar reclamações repetidas, pedidos de solução, improvisos e workflows quebrados.

#### Modo oportunidades rápidas
Buscar problemas que parecem resolvíveis por microproduto, automação ou ferramenta pequena.

### 31.7. Papel da IA nesta sessão

A IA não deve apenas resumir scraping. Ela deve:
- agrupar padrões;
- detectar dores reais;
- separar moda de necessidade;
- sugerir possíveis produtos;
- atribuir scores;
- identificar temas repetidos com potencial de renda extra.

### 31.8. Definition of Done da sessão de Ideias

A sessão de Ideias só está “done” quando uma ideia não é apenas um link salvo, mas sim uma oportunidade estruturada com:
- problema identificável;
- público provável;
- hipótese de produto;
- hipótese de monetização;
- prioridade relativa frente às demais.

---

## 32. Prompt-base para coleta de ideias por scraping + análise de IA

O objetivo deste prompt é orientar um agente como Claude Code a coletar sinais em comunidades e transformá-los em oportunidades de produto úteis para o Vibe Workbook.

### 32.1. Prompt-base

```text
Você vai atuar como pesquisador de oportunidades de produto.

Objetivo:
coletar sinais reais de dor, frustração, necessidade recorrente, workaround improvisado, pedido de ferramenta e oportunidades de monetização em comunidades online, e transformar isso em um arsenal estruturado de possíveis produtos.

Contexto:
- estamos buscando ideias de produtos pequenos ou médios que possam gerar renda extra;
- priorizamos ideias que possam virar micro-SaaS, automação, utilitário, assistente vertical, painel, ferramenta interna vendável ou app simples;
- queremos separar ruído de oportunidade real;
- não basta listar links ou posts: é preciso estruturar as oportunidades.

Fontes possíveis:
- Reddit
- X / Twitter
- Google / web aberta
- fóruns e comunidades especializadas
- outras fontes acessíveis por scraping ou busca

Ferramentas sugeridas:
- Maxun
- Scrapling
- mecanismos de scraping / crawling permitidos no ambiente

Tarefa:
1. coletar posts, comentários, threads e discussões sobre dores, frustrações, pedidos de solução, processos manuais chatos, workflows quebrados e tarefas repetitivas;
2. agrupar sinais semelhantes;
3. identificar padrões de problema;
4. transformar padrões em hipóteses de produto;
5. priorizar as melhores oportunidades.

Busque especialmente temas ligados a:
- produtividade pessoal e profissional
- automação de trabalho manual
- pequenas empresas e negócios locais
- criadores de conteúdo
- freelancers
- vendas e atendimento
- organização pessoal
- integrações entre ferramentas
- análise de dados simplificada
- geração de documentos
- CRM simples
- finanças pessoais ou operacionais
- nichos subatendidos
- dores repetidas em software confuso
- processos burocráticos que as pessoas odeiam repetir
- necessidades recorrentes em comunidades brasileiras, quando houver sinais suficientes

Sinais fortes que quero encontrar:
- pessoas dizendo “eu queria uma ferramenta que...”
- pessoas usando planilhas ou gambiarra para resolver algo repetitivo
- reclamações sobre software caro, complexo ou ruim
- pedidos recorrentes por automatização
- dores frequentes de nichos específicos
- grupos de pessoas com o mesmo problema e sem boa solução atual
- comportamentos repetidos que indiquem necessidade latente

Para cada oportunidade identificada, gere:
- titulo_curto
- problema
- publico_alvo
- sinais_encontrados
- links_ou_referencias
- frequencia_aparente
- intensidade_da_dor
- hipotese_de_produto
- formato_do_produto (micro-saas, automacao, utilitario, app, etc.)
- monetizacao_possivel
- velocidade_estimada_de_execucao
- diferencial_para_o_criador
- score_final
- observacoes

Critérios de prioridade:
- dor recorrente
- clareza do problema
- frequência de ocorrência
- potencial de monetização
- simplicidade de execução
- aderência às capacidades do criador
- possibilidade de validar rápido

Importante:
- não entregue só uma lista de links;
- não se encante com buzzword vazia;
- prefira dores reais e repetidas a ideias “cool”; 
- destaque oportunidades pequenas, práticas e vendáveis;
- se encontrar muitas ideias, agrupe por cluster temático.

Formato de saída:
1. resumo executivo
2. clusters de oportunidades
3. top oportunidades priorizadas
4. tabela estruturada do arsenal de ideias
5. recomendações das 5 melhores para iniciar
```

### 32.2. Temas prioritários para a primeira rodada

Para a primeira coleta, priorizar temas com maior chance de aderência ao operador:
- automação operacional e administrativa;
- ferramentas simples para empresas pequenas;
- organização de trabalho com IA;
- geração e gestão de documentos;
- integrações e fluxos quebrados entre sistemas;
- CRM/atendimento simplificado;
- assistentes voltados a tarefas repetitivas;
- utilitários para nichos profissionais que trabalham em desktop/web.

---

## 33. Atualizador contínuo de ideias

No futuro, a camada de Ideias pode ganhar um atualizador contínuo que:
- revarre fontes periodicamente;
- detecta temas em ascensão;
- compara clusters antigos e novos;
- aponta tendências, saturação ou novidade;
- alimenta automaticamente o arsenal de oportunidades.

### 33.1. Resultado esperado

O operador passa a ter uma fila viva de possibilidades, em vez de depender de lampejos aleatórios.

---

## 34. Próxima orientação para agentes autônomos

Toda atuação futura de agente deve obedecer esta ordem:

1. proteger a honestidade semântica do sistema;
2. validar fluxos reais no navegador;
3. corrigir um bug por vez;
4. revalidar antes de avançar;
5. priorizar o que aumenta confiança e reduz retrabalho;
6. alimentar e estruturar a sessão de Ideias com oportunidades reais quando isso fizer sentido;
7. só depois expandir capacidades visuais ou camadas adicionais.

Esse é o rumo correto do Vibe Workbook no cenário atual.

