# Requisitos funcionais

O diagrama (mdr_pdm) não lista requisitos. Os requisitos abaixo foram derivados das entidades do modelo e do CSV do BPS 2026.

| ID | Requisito | Perfis | Onde |
|----|-----------|--------|------|
| RF01 | Autenticar usuário por e-mail e senha; bloquear usuário inativo (`fg_ativo = 'N'`) | todos | `POST /api/auth/login` |
| RF02 | Manter usuários (CRUD), com senha guardada só como hash scrypt | ADMIN | `/api/crud/usuario` |
| RF03 | Manter estados e municípios | ADMIN, OPERADOR | `/api/crud/estado`, `/api/crud/municipio` |
| RF04 | Manter fabricantes, fornecedores e instituições, validando os dígitos do CNPJ | ADMIN, OPERADOR | `/api/crud/{fabricante,fornecedor,instituicao}` |
| RF05 | Manter PDM e medicamentos (CATMAT) | ADMIN, OPERADOR | `/api/crud/{pdm,medicamento}` |
| RF06 | Manter processos de compra; registrar automaticamente o usuário que cadastrou | ADMIN, OPERADOR | `/api/crud/processo_compra` |
| RF07 | Manter itens de compra; registrar o usuário e a data de inserção; calcular o total (qtd × preço unitário) quando não for informado | ADMIN, OPERADOR | `/api/crud/item_compra` |
| RF08 | Consultar todos os cadastros com busca, ordenação e paginação | todos | `GET /api/crud/:tabela` |
| RF09 | Importar o CSV anual do BPS de forma idempotente (reimportar não duplica, porque o item é identificado por `co_seq_bps`) | ADMIN, OPERADOR | `POST /api/importacao`, `npm run importar` |
| RF10 | Mapa: gasto, itens e processos por estado; ao clicar em um estado, os mesmos dados por município, com resumo da região selecionada | todos | `/api/dashboard/mapa/*` |
| RF11 | Preço de referência: para um CATMAT e uma unidade de fornecimento, mostrar mínimo, quartis, mediana, máximo, preço por UF, evolução mensal e preço por fornecedor | todos | `/api/dashboard/precos/*` |
| RF12 | Alerta de sobrepreço: listar itens com preço unitário acima de N × a mediana nacional do mesmo CATMAT, unidade e ano, ordenados pelo valor pago a mais | todos | `/api/dashboard/sobrepreco` |
| RF13 | Mercado: ranking de fornecedores e fabricantes, concentração (HHI), participação de genéricos, modalidades e esferas | todos | `/api/dashboard/mercado` |

## Regras de negócio

- **RN01.** Exclusões que quebram histórico são bloqueadas pelas FKs (`RESTRICT`). A exceção é o item, que é apagado junto com o processo (`CASCADE`).
- **RN02.** Um usuário com perfil CONSULTA só lê dados e dashboards.
- **RN03.** Comparações de preço usam sempre o mesmo CATMAT **e** a mesma unidade de fornecimento. No CSV de 2026, 133 CATMATs aparecem com mais de uma unidade, e comparar FRASCO com COMPRIMIDO daria um "sobrepreço" falso.
- **RN04.** O sobrepreço só é calculado quando o grupo de comparação tem pelo menos 5 compras (o mínimo é configurável). Abaixo disso, a mediana não é confiável.
- **RN05.** Um item com preço unitário acima de 100× a mediana do grupo é considerado atípico (erro de digitação provável) e fica fora dos totais dos dashboards, a menos que o usuário escolha incluí-lo. No CSV de 2026, 89 itens (0,6%) somam 80% do valor declarado. O maior deles é amoxicilina a R$ 51.038,16 a cápsula, que sozinha soma R$ 13,4 bilhões.
