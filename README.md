# BPS: Banco de Preços em Saúde

API de CRUD e dashboards sobre as compras públicas de medicamentos do BPS. Feita em NestJS + MySQL 8, com SQL puro (`mysql2`, sem ORM). A interface fica no projeto `bps-web` (Vite + React + shadcn/ui).

- **Requisitos funcionais:** `docs/requisitos.md`
- **Decisões de arquitetura:** `docs/ADR-001-arquitetura.md` e `docs/ADR-002-frontend-react.md`

## Como rodar com Docker (desenvolvimento)

Pré-requisito: Docker com Compose. O comando abaixo sobe a API e um MySQL 8 já com as tabelas e os 27 estados. Alterações em `src/` recompilam e reiniciam a API.

```bash
docker compose up -d --build
docker compose exec api node dist/scripts/criar-admin.js voce@exemplo.com suasenha123 "Seu Nome"
```

A API fica em `http://localhost:3000/api`, e o MySQL em `localhost:3308` (banco `bps`, usuário `bps`, senha `bps_dev`). Para usar outras portas, defina `BPS_API_PORT` e `BPS_DB_PORT`. Para mostrar o SQL no log, use `BPS_LOG_SQL=1`.

| Ação | Comando |
|---|---|
| Ver os logs | `docker compose logs -f api` |
| Importar um CSV colocado em `uploads/` | `docker compose exec api node dist/scripts/importar.js uploads/2026.csv` |
| Parar e manter os dados | `docker compose down` |
| Apagar os dados e recriar o banco | `docker compose down -v && docker compose up -d --build` |

## Deploy no Railway

O GitHub Actions valida cada PR e push. Na `main`, depois de passar, publica com `railway up`. O deploy fica desligado até a variável `RAILWAY_SERVICE` existir no repositório.

1. No Railway, crie um projeto com um MySQL e um serviço vazio chamado `bps-api`. Não conecte o serviço ao GitHub, para não publicar duas vezes.
2. Defina no serviço: `DB_HOST=${{MySQL.MYSQLHOST}}`, `DB_PORT=${{MySQL.MYSQLPORT}}`, `DB_USER=${{MySQL.MYSQLUSER}}`, `DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}`, `DB_NAME=bps`, `PORT=3000` e um `APP_SECRET` longo e aleatório.
3. Configure o healthcheck do serviço como `/api/health`.
4. Crie um token de projeto para o ambiente `production` e salve no GitHub: secret `RAILWAY_TOKEN` e variável `RAILWAY_SERVICE=bps-api`.
5. Só no primeiro deploy, crie o banco e o admin pelo shell do serviço. **`criar-banco` apaga as tabelas existentes.**

```bash
railway ssh --service bps-api
node dist/scripts/criar-banco.js
node dist/scripts/criar-admin.js voce@exemplo.com suasenha123 "Seu Nome"
```

## Como rodar sem Docker

Pré-requisitos: Node 20.6+ e MySQL **8.0.16+**. As funções de janela, as CTEs e os CHECK aplicados de fato só existem a partir dessa versão; MariaDB e MySQL 5.7 não servem.

```bash
npm install
cp .env.example .env              # preencha DB_PASSWORD e APP_SECRET
npm run build
npm run db:criar                  # cria o banco "bps" e as tabelas (APAGA as existentes)
npm run criar-admin -- voce@exemplo.com suasenha123 "Seu Nome"
npm run importar -- caminho/2026.csv
npm start                         # API em http://localhost:3000/api
```

Com a API no ar, rode a interface em outro terminal:

```bash
cd ../bps-web
npm install
npm run dev                       # http://localhost:5173
```

Também dá para criar o banco pelo cliente do MySQL: `mysql -u root -p < database/01_schema.sql`, depois `02_seed_estados.sql`. O CSV também pode ser importado pela tela **Importar CSV** do `bps-web`.

Para mostrar o SQL gerado pelo CRUD, use `LOG_SQL=1` no `.env`: toda query aparece no console.

## Estrutura

```
database/            DDL MySQL e carga dos 27 estados
src/
  database/          pool mysql2, transações, tradução de erros do MySQL para HTTP
  auth/              login (token HMAC-SHA256), senhas com scrypt, guard de perfis
  crud/              CRUD genérico: tables.ts descreve as 10 tabelas; crud.service.ts gera o SQL
  importacao/        leitor de CSV em streaming + importador idempotente
  dashboard/         SQL dos 4 dashboards (CTEs, ROW_NUMBER, mediana)
  scripts/           criar-banco, criar-admin, importar
```

## Perfis

| Perfil | Pode |
|---|---|
| ADMIN | tudo, inclusive usuários |
| OPERADOR | cadastrar, editar, excluir e importar; não vê usuários |
| CONSULTA | só ler cadastros e dashboards |

## Dashboards

1. **Mapa.** Estados coloridos por valor, itens, processos ou instituições. Ao clicar em um estado, aparecem os municípios; o painel lateral mostra indicadores e rankings da região selecionada.
2. **Preço de referência.** Para um CATMAT e uma unidade de fornecimento: mediana, quartis, preço por UF, evolução mensal, preço por fornecedor e as compras mais caras.
3. **Alerta de sobrepreço.** Itens acima de N × a mediana nacional do mesmo CATMAT, unidade e ano, ordenados pelo valor pago a mais.
4. **Mercado.** Maiores fornecedores e fabricantes, concentração (HHI), genéricos, modalidades, esfera × tipo de compra e valor por mês.

As malhas do mapa vêm da API do IBGE em tempo real, então o **navegador** precisa de internet. O CSV não traz código IBGE, e o mapa casa os municípios pelo nome. Os nomes que não casam aparecem listados abaixo do mapa.

## Ajustes feitos no modelo (o CSV não cabia nele)

| Onde | Antes | Agora | Por quê |
|---|---|---|---|
| `medicamento.ds_item` | VARCHAR(450) | VARCHAR(600) | O CSV de 2026 tem descrições com até 540 caracteres |
| `pdm.no_classe` | VARCHAR(60) | VARCHAR(100) | Há nomes de classe com 80 caracteres |
| CHECKs | — | perfil, flags S/N, CNPJ com 14 dígitos, quantidade > 0, preços ≥ 0 | Regras que antes ficavam só na aplicação |

Atualize o diagrama com esses tamanhos. Sem isso, o DDL entregue não corresponde ao modelo.

## Problemas do modelo que os dados revelaram (não corrigidos, para você decidir)

1. **`pdm` não está na 3FN.** No CSV, `co_pdm → co_classe → no_classe`: o nome da classe depende da classe, não do PDM. São só 16 classes repetidas em 1.168 PDMs. Para normalizar, crie `classe(id_classe, co_classe, no_classe)` e troque, em `pdm`, `co_classe`/`no_classe` por `id_classe`. Numa disciplina que avalia normalização, isso provavelmente vai ser cobrado.
2. **`ano_compra` é redundante.** Ele é sempre o ano de `dt_compra`. O CRUD já deriva um do outro, mas, a rigor, é dependência funcional entre atributos não-chave.
3. **Um processo não é identificado pelo número.** O mesmo `(instituição, nu_processo_compra, ano)` aparece com datas, modalidades e atas diferentes: 959 combinações viram 1.516 processos. Por isso não há UNIQUE natural em `processo_compra`, e o importador identifica o processo por todos os atributos.
4. **`nu_ata` tem lixo.** "SIM" aparece 1.470 vezes e "Diversas" 296 vezes. O campo é importado como veio.
5. **`co_seq_bps` é obrigatório.** Um item cadastrado à mão (fora do BPS) precisa de um código inventado. Se o sistema for aceitar compras próprias, torne a coluna NULL; a UNIQUE continua valendo, porque o MySQL aceita vários NULL.
6. **Preços digitados errado.** 89 itens (0,6%) têm preço unitário acima de 100× a mediana e somam 80% do valor total de 2026. Os dashboards os excluem dos totais por padrão (há um filtro para incluí-los), e o Alerta de sobrepreço permite listá-los.
