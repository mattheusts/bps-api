# ADR-001: Arquitetura da aplicação BPS (CRUD + dashboards)

**Status:** Aceito
**Data:** 2026-11-21
**Decisores:** Matheus (e o professor, se ele exigir uma estrutura diferente)

## Contexto

O trabalho exige implementar os requisitos funcionais do modelo lógico do BPS: CRUD das 10 tabelas, um dashboard com mapa por estado e município e mais três dashboards. As restrições vêm da disciplina de Banco de Dados:

- **NestJS + MySQL, sem ORM.** O SQL precisa ficar visível e avaliável.
- **Os dados vêm do CSV anual do BPS.** O de 2026 tem 15.705 linhas, 137 instituições, 3.976 CATMATs e 834 fornecedores.
- **Não há verba nem infraestrutura.** O projeto roda localmente.

## Decisão

Monolito NestJS servindo uma API REST em `/api` e um frontend estático (HTML + JS puro, Leaflet, Chart.js) na raiz. O acesso a dados usa `mysql2` com SQL parametrizado. O CRUD é **genérico, guiado por metadados** (`src/crud/tables.ts`). Os dashboards usam **SQL dedicado e escrito à mão** (`src/dashboard/dashboard.service.ts`).

## Opções consideradas

### Opção A: CRUD genérico por metadados + SQL dedicado nos dashboards (escolhida)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média: um único service gera SELECT/INSERT/UPDATE/DELETE a partir da definição da tabela |
| Volume de código | Baixo: as 10 tabelas são ~250 linhas de metadados, não 10 módulos |
| Avaliação acadêmica | O SQL dos dashboards (CTEs, funções de janela, mediana) fica explícito; o do CRUD é gerado |
| Segurança | Identificadores vêm só de uma whitelist; valores sempre como parâmetro `?` |

**Prós:** uma única tela de CRUD serve todas as tabelas. Validação, paginação e tratamento de erro são escritos uma vez só.
**Contras:** o professor não vê um `INSERT INTO fabricante ...` literal no código. A query só existe em tempo de execução, e o log de SQL (`LOG_SQL=1`) mostra o texto gerado.

### Opção B: um módulo NestJS por tabela, com SQL literal

| Dimensão | Avaliação |
|---|---|
| Complexidade | Baixa por arquivo, alta no total |
| Volume de código | ~10 × (controller + service + DTO) ≈ 30 arquivos quase idênticos |
| Avaliação acadêmica | Cada query fica literal no código |

**Prós:** é o mais didático e o mais fácil de explicar em uma apresentação.
**Contras:** muita duplicação. Uma correção na paginação ou na validação precisa ser feita dez vezes.

### Opção C: frontend em React/Angular

**Contras:** exige build e mais dependências, e não acrescenta nada ao que a disciplina avalia. Descartada.

## Análise de trade-offs

O ponto de decisão é **didática contra duplicação**. A Opção A concentra a complexidade em `crud.service.ts`. Se o professor exigir SQL literal por tabela, a migração para a Opção B é mecânica: os metadados de `tables.ts` já dizem exatamente quais colunas e FKs cada query usa.

Nos dashboards, a escolha foi calcular tudo no banco (CTEs + `ROW_NUMBER() OVER`) em vez de trazer linhas para o Node. A mediana em MySQL não tem função nativa, e implementá-la com funções de janela é justamente o tipo de SQL que vale mostrar.

## Consequências

- **Fica mais fácil:** acrescentar uma tabela (só metadados) e mudar regras de validação globalmente.
- **Fica mais difícil:** casos especiais por tabela. Hoje existem hooks `beforeSave` para hash de senha e para o total do item; se aparecerem muitos, a abstração deixa de compensar.
- **Exige MySQL 8.0+:** por causa das funções de janela, das CTEs e de CHECK constraints que sejam de fato aplicadas.
- **Mapas dependem de internet no navegador:** as malhas (GeoJSON) vêm da API do IBGE. Sem internet, os mapas não carregam, mas os gráficos funcionam.
- **Os totais excluem preços atípicos por padrão (RN05):** é uma decisão de produto, não só técnica. Sem ela, o mapa mostraria R$ 24,2 bi em vez de R$ 4,7 bi, com 55% vindo de um único item digitado errado.
- **Sobrepreço é recalculado a cada consulta:** com 15 mil linhas isso leva milissegundos. Com várias bases anuais, vale materializar as medianas em uma tabela.

## Itens de ação

1. [x] DDL MySQL a partir do modelo
2. [x] Importador idempotente do CSV
3. [x] CRUD, autenticação e perfis
4. [x] Quatro dashboards
5. [ ] Rodar contra um MySQL real (o código não foi executado no ambiente em que foi escrito)
6. [ ] Decidir com o professor se `pdm` deve ser normalizada (ver README, "Problemas do modelo")
