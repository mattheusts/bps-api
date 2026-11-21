import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface Filtros {
  ano?: string;
  uf?: string;
  id_municipio?: string;
  catmat?: string;
  esfera?: string;
  tp_compra?: string;
  /** 'incluir' para considerar preços atípicos; por padrão eles ficam fora dos totais. */
  atipicos?: string;
}

/** Preço unitário acima de FATOR_ATIPICO × a mediana do grupo é tratado como erro de digitação. */
export const FATOR_ATIPICO = 100;

/** Itens numerados por preço dentro do grupo (medicamento, unidade, ano). */
const ORDENADOS = `
  SELECT ic2.id_item_compra, ic2.vl_preco_unitario AS p, ic2.id_medicamento AS med,
         COALESCE(ic2.un_fornecimento, '') AS un, pc2.ano_compra AS ano,
         ROW_NUMBER() OVER (PARTITION BY ic2.id_medicamento, COALESCE(ic2.un_fornecimento, ''), pc2.ano_compra
                            ORDER BY ic2.vl_preco_unitario) AS rn,
         COUNT(*) OVER (PARTITION BY ic2.id_medicamento, COALESCE(ic2.un_fornecimento, ''), pc2.ano_compra) AS n
  FROM item_compra ic2
  JOIN processo_compra pc2 ON pc2.id_processo_compra = ic2.id_processo_compra`;

/**
 * Itens com preço atípico. No CSV de 2026, 89 itens (0,6%) somam 80% do valor total:
 * ex.: amoxicilina 500 mg a R$ 51.038,16 a cápsula (mediana R$ 0,19), um único item de R$ 13,4 bilhões.
 * Sem excluí-los, mapa e mercado mostram R$ 24 bi em vez de ~R$ 4,7 bi.
 */
const ATIPICOS = `
  SELECT o.id_item_compra
  FROM (${ORDENADOS}) o
  JOIN (SELECT med, un, ano, AVG(p) AS mediana, MAX(n) AS n
          FROM (${ORDENADOS}) x
         WHERE rn IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2))
         GROUP BY med, un, ano) r
    ON r.med = o.med AND r.un = o.un AND r.ano = o.ano
  WHERE r.n >= 5 AND o.p > r.mediana * ${FATOR_ATIPICO}`;

/** Junções que ligam cada item à sua localidade e ao medicamento. Base de todos os dashboards. */
const BASE = `
  FROM item_compra ic
  JOIN processo_compra pc ON pc.id_processo_compra = ic.id_processo_compra
  JOIN instituicao i      ON i.id_instituicao = pc.id_instituicao
  JOIN municipio m        ON m.id_municipio = i.id_municipio
  JOIN estado e           ON e.id_estado = m.id_estado
  JOIN medicamento med    ON med.id_medicamento = ic.id_medicamento`;

/** Mediana e quartis por posição (nearest-rank), já que o MySQL não tem MEDIAN(). Usa colunas rn e n. */
const ESTATISTICAS = `
  COUNT(*) AS n,
  MIN(p) AS minimo,
  MAX(CASE WHEN rn = GREATEST(1, CEIL(0.25 * n)) THEN p END) AS p25,
  AVG(CASE WHEN rn IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2)) THEN p END) AS mediana,
  MAX(CASE WHEN rn = GREATEST(1, CEIL(0.75 * n)) THEN p END) AS p75,
  MAX(p) AS maximo,
  AVG(p) AS media,
  SUM(p * q) / SUM(q) AS media_ponderada`;

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  /** Monta o WHERE a partir dos filtros recebidos. Valores sempre como parâmetro. */
  private filtrar(f: Filtros, ignorar: (keyof Filtros)[] = []): { where: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    const add = (chave: keyof Filtros, sql: string, valor: unknown) => {
      if (ignorar.includes(chave) || f[chave] === undefined || f[chave] === '') return;
      conds.push(sql);
      params.push(valor);
    };
    add('ano', 'pc.ano_compra = ?', Number(f.ano));
    add('uf', 'e.sg_uf = ?', String(f.uf).toUpperCase());
    add('id_municipio', 'm.id_municipio = ?', Number(f.id_municipio));
    add('catmat', 'med.co_catmat = ?', Number(f.catmat));
    add('esfera', 'i.ds_esfera = ?', f.esfera);
    add('tp_compra', 'pc.tp_compra = ?', f.tp_compra);
    if (!ignorar.includes('atipicos') && f.atipicos !== 'incluir') conds.push(`ic.id_item_compra NOT IN (${ATIPICOS})`);
    return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  /** Valores disponíveis para os filtros (anos, esferas, tipos). */
  async filtros() {
    const [anos, esferas, tipos] = await Promise.all([
      this.db.query<{ v: number }>('SELECT DISTINCT ano_compra AS v FROM processo_compra ORDER BY v DESC'),
      this.db.query<{ v: string }>('SELECT DISTINCT ds_esfera AS v FROM instituicao ORDER BY v'),
      this.db.query<{ v: string }>('SELECT DISTINCT tp_compra AS v FROM processo_compra ORDER BY v'),
    ]);
    return { anos: anos.map((r) => r.v), esferas: esferas.map((r) => r.v), tipos: tipos.map((r) => r.v) };
  }

  /** Autocomplete de medicamento: só os que têm compras. */
  async buscarMedicamentos(q: string) {
    const termo = (q ?? '').trim();
    if (termo.length < 2) return [];
    const porCodigo = /^\d+$/.test(termo);
    return this.db.query(
      `SELECT med.co_catmat, med.ds_item, COUNT(*) AS n
         FROM medicamento med
         JOIN item_compra ic ON ic.id_medicamento = med.id_medicamento
        WHERE ${porCodigo ? 'med.co_catmat = ?' : 'med.ds_item LIKE ?'}
        GROUP BY med.id_medicamento, med.co_catmat, med.ds_item
        ORDER BY n DESC
        LIMIT 20`,
      [porCodigo ? Number(termo) : `%${termo}%`],
    );
  }

  // ============================================================ 1. MAPA

  /** Totais por estado. Estados sem compra não aparecem; o frontend os pinta como zero. */
  async mapaEstados(f: Filtros) {
    const { where, params } = this.filtrar(f, ['uf', 'id_municipio']);
    return this.db.query(
      `SELECT e.sg_uf, e.no_estado,
              SUM(ic.vl_preco_total)                AS vl_total,
              COUNT(*)                              AS qt_itens,
              COUNT(DISTINCT pc.id_processo_compra) AS qt_processos,
              COUNT(DISTINCT i.id_instituicao)      AS qt_instituicoes
       ${BASE} ${where}
       GROUP BY e.id_estado, e.sg_uf, e.no_estado`,
      params,
    );
  }

  /** Totais por município de um estado. co_ibge pode ser nulo: o frontend casa pelo nome. */
  async mapaMunicipios(uf: string, f: Filtros) {
    const { where, params } = this.filtrar({ ...f, uf }, ['id_municipio']);
    return this.db.query(
      `SELECT m.id_municipio, m.no_municipio, m.co_ibge,
              SUM(ic.vl_preco_total)                AS vl_total,
              COUNT(*)                              AS qt_itens,
              COUNT(DISTINCT pc.id_processo_compra) AS qt_processos,
              COUNT(DISTINCT i.id_instituicao)      AS qt_instituicoes
       ${BASE} ${where}
       GROUP BY m.id_municipio, m.no_municipio, m.co_ibge`,
      params,
    );
  }

  /** Painel lateral do mapa: indicadores e rankings da região selecionada (Brasil, UF ou município). */
  async mapaResumo(f: Filtros) {
    const { where, params } = this.filtrar(f);
    const [kpi, medicamentos, instituicoes] = await Promise.all([
      this.db.one(
        `SELECT COALESCE(SUM(ic.vl_preco_total), 0)  AS vl_total,
                COUNT(*)                             AS qt_itens,
                COUNT(DISTINCT pc.id_processo_compra) AS qt_processos,
                COUNT(DISTINCT i.id_instituicao)     AS qt_instituicoes,
                COUNT(DISTINCT med.id_medicamento)   AS qt_medicamentos,
                COUNT(DISTINCT ic.id_fornecedor)     AS qt_fornecedores
         ${BASE} ${where}`,
        params,
      ),
      this.db.query(
        `SELECT med.co_catmat, med.ds_item, SUM(ic.vl_preco_total) AS vl_total, SUM(ic.qt_medicamento) AS qt
         ${BASE} ${where}
         GROUP BY med.id_medicamento, med.co_catmat, med.ds_item
         ORDER BY vl_total DESC LIMIT 10`,
        params,
      ),
      this.db.query(
        `SELECT i.no_instituicao, m.no_municipio, e.sg_uf, SUM(ic.vl_preco_total) AS vl_total
         ${BASE} ${where}
         GROUP BY i.id_instituicao, i.no_instituicao, m.no_municipio, e.sg_uf
         ORDER BY vl_total DESC LIMIT 10`,
        params,
      ),
    ]);
    return { kpi, medicamentos, instituicoes };
  }

  // ============================================================ 2. PREÇO DE REFERÊNCIA

  /** Unidades de fornecimento em que o CATMAT foi comprado. Preços só são comparáveis dentro da mesma unidade. */
  async precoUnidades(catmat: string, f: Filtros) {
    const { where, params } = this.filtrar({ ...f, catmat }, ['atipicos']);
    return this.db.query(
      `SELECT COALESCE(ic.un_fornecimento, '') AS un, COUNT(*) AS n
       ${BASE} ${where}
       GROUP BY un ORDER BY n DESC`,
      params,
    );
  }

  async preco(catmat: string, un: string | undefined, f: Filtros) {
    if (!/^\d+$/.test(catmat ?? '')) throw new BadRequestException('Informe o CATMAT.');
    // Aqui os atípicos aparecem: a mediana é robusta a eles e a tabela "compras mais caras" serve para achá-los.
    const filtro = this.filtrar({ ...f, catmat }, ['atipicos']);
    let where = filtro.where;
    const params = [...filtro.params];
    if (un !== undefined) {
      where += `${where ? ' AND' : 'WHERE'} COALESCE(ic.un_fornecimento, '') = ?`;
      params.push(un === '(vazio)' ? '' : un); // '(vazio)' = itens sem unidade informada
    }

    // CTE com os preços do recorte, numerados por ordem de preço (rn) dentro de cada grupo.
    const cte = (particao: string) => `
      WITH base AS (
        SELECT ic.vl_preco_unitario AS p, ic.qt_medicamento AS q, e.sg_uf, ic.id_fornecedor,
               DATE_FORMAT(pc.dt_compra, '%Y-%m') AS mes
        ${BASE} ${where}
      ),
      ord AS (
        SELECT b.*,
               ROW_NUMBER() OVER (${particao} ORDER BY p) AS rn,
               COUNT(*)     OVER (${particao})            AS n
        FROM base b
      )`;

    const [medicamento, geral, porUf, porMes, porFornecedor, compras] = await Promise.all([
      this.db.one('SELECT co_catmat, ds_item FROM medicamento WHERE co_catmat = ?', [Number(catmat)]),
      this.db.one(`${cte('')} SELECT ${ESTATISTICAS} FROM ord`, params),
      this.db.query(`${cte('PARTITION BY sg_uf')} SELECT sg_uf, ${ESTATISTICAS} FROM ord GROUP BY sg_uf ORDER BY mediana`, params),
      this.db.query(`${cte('PARTITION BY mes')} SELECT mes, ${ESTATISTICAS} FROM ord GROUP BY mes ORDER BY mes`, params),
      this.db.query(
        `${cte('PARTITION BY id_fornecedor')}
         SELECT f.no_fornecedor, x.*
         FROM (SELECT id_fornecedor, ${ESTATISTICAS} FROM ord GROUP BY id_fornecedor) x
         JOIN fornecedor f ON f.id_fornecedor = x.id_fornecedor
         ORDER BY x.n DESC LIMIT 15`,
        params,
      ),
      this.db.query(
        `SELECT ic.co_seq_bps, pc.dt_compra, e.sg_uf, m.no_municipio, i.no_instituicao, f.no_fornecedor,
                ic.qt_medicamento, ic.vl_preco_unitario, ic.vl_preco_total
         ${BASE} JOIN fornecedor f ON f.id_fornecedor = ic.id_fornecedor
         ${where}
         ORDER BY ic.vl_preco_unitario DESC LIMIT 50`,
        params,
      ),
    ]);
    return { medicamento, geral, porUf, porMes, porFornecedor, compras };
  }

  // ============================================================ 3. SOBREPREÇO

  /**
   * Itens com preço unitário acima de `fator` × a mediana nacional do mesmo CATMAT,
   * unidade de fornecimento e ano. Só considera grupos com pelo menos `minAmostra` compras.
   * A referência é sempre nacional; o filtro de UF/esfera só restringe quais itens são listados.
   */
  async sobrepreco(f: Filtros & { fator?: string; min_amostra?: string; limite?: string }) {
    const fator = Math.max(Number(f.fator) || 1.5, 1);
    const minAmostra = Math.max(Number(f.min_amostra) || 5, 2);
    const limite = Math.min(Math.max(Number(f.limite) || 100, 1), 500);

    // A referência usa só o filtro de ano (e de CATMAT, se houver); os demais filtram a lista.
    const ref = this.filtrar(f, ['uf', 'id_municipio', 'esfera', 'tp_compra', 'atipicos']);
    // Como nos outros dashboards, os atípicos (>100×, quase sempre erro de digitação) ficam fora,
    // a menos que atipicos=incluir. Com eles, o "pago a mais" de 2026 salta de R$ 127 mi para R$ 19,7 bi.
    const lista = this.filtrar(f);
    const listaWhere = lista.where.replace(/^WHERE/, 'AND');

    const cte = `
      WITH precos AS (
        SELECT med.co_catmat, COALESCE(ic.un_fornecimento, '') AS un, pc.ano_compra, ic.vl_preco_unitario AS p
        ${BASE} ${ref.where}
      ),
      ord AS (
        SELECT co_catmat, un, ano_compra, p,
               ROW_NUMBER() OVER (PARTITION BY co_catmat, un, ano_compra ORDER BY p) AS rn,
               COUNT(*)     OVER (PARTITION BY co_catmat, un, ano_compra)            AS n
        FROM precos
      ),
      referencia AS (
        SELECT co_catmat, un, ano_compra, AVG(p) AS mediana, MAX(n) AS n
        FROM ord
        WHERE rn IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2))
        GROUP BY co_catmat, un, ano_compra
        HAVING MAX(n) >= ?
      ),
      suspeitos AS (
        SELECT ic.id_item_compra, ic.co_seq_bps, med.co_catmat, med.ds_item, COALESCE(ic.un_fornecimento, '') AS un,
               pc.ano_compra, pc.dt_compra, pc.nu_processo_compra, e.sg_uf, m.no_municipio, i.no_instituicao,
               i.ds_esfera, ic.id_fornecedor, ic.qt_medicamento, ic.vl_preco_unitario, ic.vl_preco_total,
               r.mediana, r.n AS n_amostra,
               ic.vl_preco_unitario / r.mediana                       AS razao,
               (ic.vl_preco_unitario - r.mediana) * ic.qt_medicamento AS vl_excedente
        ${BASE}
        JOIN referencia r ON r.co_catmat = med.co_catmat
                         AND r.un = COALESCE(ic.un_fornecimento, '')
                         AND r.ano_compra = pc.ano_compra
        WHERE r.mediana > 0 AND ic.vl_preco_unitario > r.mediana * ? ${listaWhere}
      )`;
    const params = [...ref.params, minAmostra, fator, ...lista.params];

    const [resumo, porUf, porFornecedor, itens] = await Promise.all([
      this.db.one(
        `${cte} SELECT COUNT(*) AS qt_itens, COALESCE(SUM(vl_excedente), 0) AS vl_excedente,
                       COALESCE(SUM(vl_preco_total), 0) AS vl_pago, COUNT(DISTINCT co_catmat) AS qt_medicamentos
                FROM suspeitos`,
        params,
      ),
      this.db.query(
        `${cte} SELECT sg_uf, COUNT(*) AS qt_itens, SUM(vl_excedente) AS vl_excedente
                FROM suspeitos GROUP BY sg_uf ORDER BY vl_excedente DESC`,
        params,
      ),
      this.db.query(
        `${cte} SELECT f.no_fornecedor, COUNT(*) AS qt_itens, SUM(s.vl_excedente) AS vl_excedente
                FROM suspeitos s JOIN fornecedor f ON f.id_fornecedor = s.id_fornecedor
                GROUP BY f.id_fornecedor, f.no_fornecedor ORDER BY vl_excedente DESC LIMIT 10`,
        params,
      ),
      this.db.query(
        `${cte} SELECT s.*, f.no_fornecedor
                FROM suspeitos s JOIN fornecedor f ON f.id_fornecedor = s.id_fornecedor
                ORDER BY s.vl_excedente DESC LIMIT ?`,
        [...params, limite],
      ),
    ]);
    return { parametros: { fator, minAmostra, limite }, resumo, porUf, porFornecedor, itens };
  }

  // ============================================================ 4. MERCADO

  async mercado(f: Filtros) {
    const { where, params } = this.filtrar(f);
    const [fornecedores, fabricantes, hhi, genericos, modalidades, esferas, mensal] = await Promise.all([
      this.db.query(
        `SELECT fo.no_fornecedor AS nome, SUM(ic.vl_preco_total) AS vl_total, COUNT(*) AS qt_itens
         ${BASE} JOIN fornecedor fo ON fo.id_fornecedor = ic.id_fornecedor
         ${where}
         GROUP BY fo.id_fornecedor, fo.no_fornecedor ORDER BY vl_total DESC LIMIT 10`,
        params,
      ),
      this.db.query(
        `SELECT fa.no_fabricante AS nome, SUM(ic.vl_preco_total) AS vl_total, COUNT(*) AS qt_itens
         ${BASE} JOIN fabricante fa ON fa.id_fabricante = ic.id_fabricante
         ${where}
         GROUP BY fa.id_fabricante, fa.no_fabricante ORDER BY vl_total DESC LIMIT 10`,
        params,
      ),
      // Índice Herfindahl-Hirschman: soma dos quadrados das participações (0-10.000).
      // Abaixo de 1.500 = pouco concentrado; acima de 2.500 = muito concentrado.
      this.db.one(
        `WITH s AS (SELECT ic.id_fornecedor, SUM(ic.vl_preco_total) AS v ${BASE} ${where} GROUP BY ic.id_fornecedor)
         SELECT COUNT(*) AS qt_fornecedores,
                COALESCE(SUM(POW(s.v / t.total, 2)) * 10000, 0) AS hhi,
                COALESCE(SUM(s.v), 0) AS vl_total
         FROM s CROSS JOIN (SELECT SUM(v) AS total FROM s) t`,
        params,
      ),
      this.db.query(
        // 'I' = não informado. (Não usar '?' literal: o mysql2 trataria como placeholder.)
        `SELECT COALESCE(ic.fg_generico, 'I') AS fg_generico, SUM(ic.vl_preco_total) AS vl_total, COUNT(*) AS qt_itens
         ${BASE} ${where} GROUP BY COALESCE(ic.fg_generico, 'I')`,
        params,
      ),
      this.db.query(
        `SELECT pc.modalidade AS nome, SUM(ic.vl_preco_total) AS vl_total, COUNT(DISTINCT pc.id_processo_compra) AS qt_processos
         ${BASE} ${where} GROUP BY pc.modalidade ORDER BY vl_total DESC`,
        params,
      ),
      this.db.query(
        `SELECT i.ds_esfera AS nome, pc.tp_compra, SUM(ic.vl_preco_total) AS vl_total
         ${BASE} ${where} GROUP BY i.ds_esfera, pc.tp_compra ORDER BY i.ds_esfera, pc.tp_compra`,
        params,
      ),
      this.db.query(
        `SELECT DATE_FORMAT(pc.dt_compra, '%Y-%m') AS mes, SUM(ic.vl_preco_total) AS vl_total, COUNT(*) AS qt_itens
         ${BASE} ${where} GROUP BY mes ORDER BY mes`,
        params,
      ),
    ]);
    return { fornecedores, fabricantes, hhi, genericos, modalidades, esferas, mensal };
  }
}
