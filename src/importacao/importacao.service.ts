import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { PoolConnection } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { lerCsv } from './csv';

/**
 * Colunas esperadas no CSV do BPS. O cabeçalho do arquivo de 2026 usa exatamente
 * os nomes do modelo; os apelidos cobrem variações de outros anos.
 * A comparação ignora maiúsculas, acentos, espaços e aspas.
 */
const COLUNAS = {
  co_seq_bps: ['co_seq_bps'],
  ano_compra: ['ano_compra', 'ano'],
  dt_compra: ['dt_compra', 'compra', 'data_compra'],
  dt_insercao: ['dt_insercao', 'insercao', 'data_insercao'],
  validade_compra: ['validade_compra', 'validade'],
  tp_compra: ['tp_compra', 'tipo_compra'],
  modalidade: ['modalidade', 'modalidade_da_compra'],
  nu_processo_compra: ['nu_processo_compra', 'processo'],
  nu_ata: ['nu_ata', 'ata'],
  cnpj_instituicao: ['cnpj_instituicao'],
  no_instituicao: ['no_instituicao', 'instituicao', 'nome_instituicao'],
  ds_esfera: ['ds_esfera', 'esfera'],
  no_municipio: ['no_municipio', 'municipio'],
  sg_uf: ['sg_uf', 'uf'],
  co_ibge: ['co_ibge', 'codigo_ibge'], // opcional: o CSV de 2026 não tem
  co_catmat: ['co_catmat', 'catmat', 'codigo_br'],
  ds_item: ['ds_item', 'descricao_catmat'],
  co_pdm: ['co_pdm'],
  no_pdm: ['no_pdm'],
  co_classe: ['co_classe'],
  no_classe: ['no_classe'],
  cnpj_fornecedor: ['cnpj_fornecedor'],
  no_fornecedor: ['no_fornecedor', 'fornecedor'],
  cnpj_fabricante: ['cnpj_fabricante'],
  no_fabricante: ['no_fabricante', 'fabricante'],
  fg_generico: ['fg_generico', 'generico'],
  registro_anvisa: ['registro_anvisa', 'anvisa'],
  un_fornecimento: ['un_fornecimento', 'unidade_fornecimento'],
  un_medida_capacidade: ['un_medida_capacidade', 'capacidade'],
  sg_unidade_medida: ['sg_unidade_medida', 'unidade_medida'],
  vl_capacidade: ['vl_capacidade'],
  qt_medicamento: ['qt_medicamento', 'qtd_itens_comprados'],
  vl_preco_unitario: ['vl_preco_unitario', 'preco_unitario'],
  vl_preco_total: ['vl_preco_total', 'preco_total'],
  ds_observacao: ['ds_observacao', 'observacao'],
} as const;

type Campo = keyof typeof COLUNAS;
const OPCIONAIS: Campo[] = ['co_ibge', 'nu_ata', 'fg_generico', 'registro_anvisa', 'un_fornecimento', 'un_medida_capacidade',
  'sg_unidade_medida', 'vl_capacidade', 'ds_observacao', 'no_instituicao'];

/** Tamanho máximo de cada coluna texto, igual ao DDL. */
const TAMANHOS: Partial<Record<Campo, number>> = {
  nu_processo_compra: 30, nu_ata: 30, tp_compra: 20, modalidade: 40, no_instituicao: 150, ds_esfera: 20,
  no_municipio: 60, ds_item: 600, no_pdm: 60, no_classe: 100, no_fornecedor: 150, no_fabricante: 150,
  registro_anvisa: 20, un_fornecimento: 20, un_medida_capacidade: 30, sg_unidade_medida: 10,
};

/** O CSV tem 276 linhas sem nome de instituição; o nome real é preenchido quando o CNPJ reaparece com nome. */
const SEM_NOME = 'NÃO INFORMADO';
const LOTE = 500;

export interface Relatorio {
  linhas: number;
  /** Itens que não existiam no banco. */
  inseridos: number;
  /** Itens cujo co_seq_bps já existia (foram atualizados com os valores do arquivo). */
  existentes: number;
  ignorados: number;
  erros: { linha: number; mensagem: string }[];
  /** Registros novos por tabela (contagem antes x depois). */
  novos: Record<string, number>;
  segundos: number;
}

const TABELAS_CONTADAS = ['municipio', 'instituicao', 'fornecedor', 'fabricante', 'pdm', 'medicamento', 'processo_compra', 'item_compra'];

type Linha = Record<Campo, string | null>;

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/["\s]/g, '').toLowerCase();

const COLS_ITEM = ['co_seq_bps', 'id_processo_compra', 'id_medicamento', 'id_fornecedor', 'id_fabricante',
  'id_usuario_insercao', 'dt_insercao', 'fg_generico', 'registro_anvisa', 'un_fornecimento', 'un_medida_capacidade',
  'sg_unidade_medida', 'vl_capacidade', 'qt_medicamento', 'vl_preco_unitario', 'vl_preco_total', 'ds_observacao'];

@Injectable()
export class ImportacaoService {
  private readonly logger = new Logger('Importação');

  constructor(private readonly db: DatabaseService) {}

  async importar(caminho: string, idUsuario: number): Promise<Relatorio> {
    const inicio = Date.now();
    const rel: Relatorio = { linhas: 0, inseridos: 0, existentes: 0, ignorados: 0, erros: [], novos: {}, segundos: 0 };
    const conn = await this.db.pool.getConnection();
    try {
      const antes = await this.contar(conn);
      const cache = await this.carregarCaches(conn);
      let indice: Map<Campo, number> | null = null;
      let lote: unknown[][] = [];

      for await (const { campos, linha } of lerCsv(caminho)) {
        if (!indice) { indice = this.mapearCabecalho(campos); continue; }
        if (campos.length === 1 && campos[0] === '') continue; // linha em branco
        rel.linhas++;

        let dados: Linha;
        try {
          dados = this.lerLinha(campos, indice);
        } catch (e) {
          this.registrarErro(rel, linha, (e as Error).message);
          continue;
        }

        if (lote.length === 0) await conn.beginTransaction();
        try {
          lote.push(await this.montarItem(conn, cache, dados, idUsuario));
        } catch (e) {
          await conn.rollback();
          throw new BadRequestException(`Linha ${linha}: ${(e as { sqlMessage?: string }).sqlMessage ?? (e as Error).message}`);
        }
        if (lote.length >= LOTE) { await this.gravarLote(conn, lote); lote = []; }
        if (rel.linhas % 5000 === 0) this.logger.log(`${rel.linhas} linhas processadas`);
      }
      if (!indice) throw new BadRequestException('Arquivo vazio.');
      if (lote.length) await this.gravarLote(conn, lote);

      const depois = await this.contar(conn);
      for (const t of TABELAS_CONTADAS) rel.novos[t] = depois[t] - antes[t];
      rel.inseridos = rel.novos.item_compra;
      rel.existentes = rel.linhas - rel.ignorados - rel.inseridos;
    } finally {
      conn.release();
    }
    rel.segundos = Math.round((Date.now() - inicio) / 100) / 10;
    return rel;
  }

  // ------------------------------------------------------------------ leitura

  private mapearCabecalho(cabecalho: string[]): Map<Campo, number> {
    const posicoes = new Map(cabecalho.map((c, i) => [normalizar(c), i]));
    const indice = new Map<Campo, number>();
    const faltando: string[] = [];
    for (const campo of Object.keys(COLUNAS) as Campo[]) {
      const pos = COLUNAS[campo].map(normalizar).map((a) => posicoes.get(a)).find((p) => p !== undefined);
      if (pos !== undefined) indice.set(campo, pos);
      else if (!OPCIONAIS.includes(campo)) faltando.push(campo);
    }
    if (faltando.length) {
      throw new BadRequestException(
        `Colunas obrigatórias ausentes no CSV: ${faltando.join(', ')}. Cabeçalho encontrado: ${cabecalho.join(', ')}`,
      );
    }
    return indice;
  }

  private lerLinha(campos: string[], indice: Map<Campo, number>): Linha {
    const d = {} as Linha;
    for (const campo of Object.keys(COLUNAS) as Campo[]) {
      const pos = indice.get(campo);
      const v = pos === undefined ? '' : (campos[pos] ?? '').trim();
      d[campo] = v === '' ? null : v;
    }
    for (const campo of Object.keys(d) as Campo[]) {
      if (d[campo] === null && !OPCIONAIS.includes(campo)) throw new Error(`campo obrigatório vazio: ${campo}`);
      const max = TAMANHOS[campo];
      if (max && d[campo] && d[campo]!.length > max) throw new Error(`${campo} tem ${d[campo]!.length} caracteres (máximo ${max})`);
    }
    for (const c of ['cnpj_instituicao', 'cnpj_fornecedor', 'cnpj_fabricante'] as const) {
      d[c] = d[c]!.replace(/\D/g, '').padStart(14, '0');
      if (d[c]!.length !== 14) throw new Error(`${c} inválido`);
    }
    d.dt_compra = this.data(d.dt_compra!);
    d.dt_insercao = this.data(d.dt_insercao!);
    d.sg_uf = d.sg_uf!.toUpperCase();
    d.no_municipio = d.no_municipio!.toUpperCase();
    if (d.fg_generico && !['S', 'N'].includes(d.fg_generico)) d.fg_generico = null;
    return d;
  }

  /** dd/mm/aaaa ou aaaa-mm-dd -> aaaa-mm-dd */
  private data(v: string): string {
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    throw new Error(`data inválida: ${v}`);
  }

  /** Aceita 1234.56, 1234,56 e 1.234,56. */
  private num(v: string | null): number | null {
    if (v === null) return null;
    let s = v;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`número inválido: ${v}`);
    return n;
  }

  private int(v: string | null): number | null {
    const n = this.num(v);
    if (n !== null && !Number.isInteger(n)) throw new Error(`inteiro inválido: ${v}`);
    return n;
  }

  private registrarErro(rel: Relatorio, linha: number, mensagem: string): void {
    rel.ignorados++;
    if (rel.erros.length < 100) rel.erros.push({ linha, mensagem });
  }

  // --------------------------------------------------------------- gravação

  private async carregarCaches(conn: PoolConnection) {
    const q = async <T>(sql: string) => (await conn.query(sql))[0] as T[];
    const estados = await q<{ id_estado: number; sg_uf: string }>('SELECT id_estado, sg_uf FROM estado');
    if (estados.length === 0) throw new BadRequestException('A tabela estado está vazia. Rode database/02_seed_estados.sql antes de importar.');
    const procs = await q<Record<string, string | number | null>>(
      `SELECT id_processo_compra, id_instituicao, nu_processo_compra, ano_compra, DATE_FORMAT(dt_compra, '%Y-%m-%d') AS dt_compra,
              tp_compra, modalidade, validade_compra, nu_ata FROM processo_compra`,
    );
    return {
      estado: new Map(estados.map((e) => [e.sg_uf, e.id_estado])),
      municipio: new Map<string, number>(),
      instituicao: new Map<string, { id: number; semNome: boolean }>(),
      fornecedor: new Map<string, number>(),
      fabricante: new Map<string, number>(),
      pdm: new Map<number, number>(),
      medicamento: new Map<number, number>(),
      processo: new Map(procs.map((p) => [this.chaveProcesso(p), Number(p.id_processo_compra)])),
    };
  }

  /**
   * No CSV, (instituição, nº do processo, ano) NÃO identifica um processo: o mesmo número aparece
   * com datas, modalidades e atas diferentes (959 combinações viram 1.516 processos distintos).
   * Por isso o processo é identificado por todos os seus atributos.
   */
  private chaveProcesso(p: Record<string, string | number | null>): string {
    return [p.id_instituicao, p.nu_processo_compra, p.ano_compra, p.dt_compra, p.tp_compra, p.modalidade, p.validade_compra, p.nu_ata ?? '']
      .join('|');
  }

  private async contar(conn: PoolConnection): Promise<Record<string, number>> {
    const sql = TABELAS_CONTADAS.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ');
    const [rows] = (await conn.query(`SELECT ${sql}`)) as [Record<string, number>[], unknown];
    return rows[0];
  }

  /**
   * Upsert com o truque LAST_INSERT_ID(pk): insertId devolve o id da linha nova
   * ou da linha já existente, em um único comando.
   */
  private async upsert(conn: PoolConnection, sql: string, params: unknown[]): Promise<number> {
    const [res] = (await conn.query(sql, params)) as [{ insertId: number }, unknown];
    return res.insertId;
  }

  private async montarItem(
    conn: PoolConnection,
    cache: Awaited<ReturnType<ImportacaoService['carregarCaches']>>,
    d: Linha,
    idUsuario: number,
  ): Promise<unknown[]> {
    const idEstado = cache.estado.get(d.sg_uf!);
    if (!idEstado) throw new Error(`UF desconhecida: ${d.sg_uf}`);

    const chaveMun = `${idEstado}|${d.no_municipio}`;
    let idMun = cache.municipio.get(chaveMun);
    if (!idMun) {
      idMun = await this.upsert(conn,
        `INSERT INTO municipio (no_municipio, id_estado, co_ibge) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE id_municipio = LAST_INSERT_ID(id_municipio), co_ibge = COALESCE(VALUES(co_ibge), co_ibge)`,
        [d.no_municipio, idEstado, this.int(d.co_ibge)]);
      cache.municipio.set(chaveMun, idMun);
    }

    const inst = cache.instituicao.get(d.cnpj_instituicao!);
    if (!inst || (inst.semNome && d.no_instituicao)) {
      const id = await this.upsert(conn,
        `INSERT INTO instituicao (cnpj_instituicao, no_instituicao, ds_esfera, id_municipio) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id_instituicao = LAST_INSERT_ID(id_instituicao),
           no_instituicao = IF(VALUES(no_instituicao) = '${SEM_NOME}', no_instituicao, VALUES(no_instituicao)),
           ds_esfera = VALUES(ds_esfera), id_municipio = VALUES(id_municipio)`,
        [d.cnpj_instituicao, d.no_instituicao ?? SEM_NOME, d.ds_esfera, idMun]);
      cache.instituicao.set(d.cnpj_instituicao!, { id, semNome: !d.no_instituicao });
    }
    const idInst = cache.instituicao.get(d.cnpj_instituicao!)!.id;

    const idForn = await this.dimensao(conn, cache.fornecedor, d.cnpj_fornecedor!,
      `INSERT INTO fornecedor (cnpj_fornecedor, no_fornecedor) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id_fornecedor = LAST_INSERT_ID(id_fornecedor), no_fornecedor = VALUES(no_fornecedor)`,
      [d.cnpj_fornecedor, d.no_fornecedor]);

    const idFab = await this.dimensao(conn, cache.fabricante, d.cnpj_fabricante!,
      `INSERT INTO fabricante (cnpj_fabricante, no_fabricante) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id_fabricante = LAST_INSERT_ID(id_fabricante), no_fabricante = VALUES(no_fabricante)`,
      [d.cnpj_fabricante, d.no_fabricante]);

    const coPdm = this.int(d.co_pdm)!;
    const idPdm = await this.dimensao(conn, cache.pdm, coPdm,
      `INSERT INTO pdm (co_pdm, no_pdm, co_classe, no_classe) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id_pdm = LAST_INSERT_ID(id_pdm), no_pdm = VALUES(no_pdm),
         co_classe = VALUES(co_classe), no_classe = VALUES(no_classe)`,
      [coPdm, d.no_pdm, this.int(d.co_classe), d.no_classe]);

    const coCatmat = this.int(d.co_catmat)!;
    const idMed = await this.dimensao(conn, cache.medicamento, coCatmat,
      `INSERT INTO medicamento (co_catmat, ds_item, id_pdm) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id_medicamento = LAST_INSERT_ID(id_medicamento), ds_item = VALUES(ds_item), id_pdm = VALUES(id_pdm)`,
      [coCatmat, d.ds_item, idPdm]);

    const proc = {
      id_instituicao: idInst, nu_processo_compra: d.nu_processo_compra, ano_compra: this.int(d.ano_compra),
      dt_compra: d.dt_compra, tp_compra: d.tp_compra, modalidade: d.modalidade,
      validade_compra: this.int(d.validade_compra), nu_ata: d.nu_ata,
    };
    const chaveProc = this.chaveProcesso(proc);
    let idProc = cache.processo.get(chaveProc);
    if (!idProc) {
      const [res] = (await conn.query(
        `INSERT INTO processo_compra (id_instituicao, id_usuario_cadastro, nu_processo_compra, nu_ata, ano_compra,
           dt_compra, tp_compra, modalidade, validade_compra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idInst, idUsuario, proc.nu_processo_compra, proc.nu_ata, proc.ano_compra, proc.dt_compra, proc.tp_compra,
          proc.modalidade, proc.validade_compra],
      )) as [{ insertId: number }, unknown];
      idProc = res.insertId;
      cache.processo.set(chaveProc, idProc);
    }

    return [
      this.int(d.co_seq_bps), idProc, idMed, idForn, idFab, idUsuario, d.dt_insercao, d.fg_generico, d.registro_anvisa,
      d.un_fornecimento, d.un_medida_capacidade, d.sg_unidade_medida, this.num(d.vl_capacidade), this.int(d.qt_medicamento),
      this.num(d.vl_preco_unitario), this.num(d.vl_preco_total), d.ds_observacao,
    ];
  }

  private async dimensao<K>(conn: PoolConnection, cache: Map<K, number>, chave: K, sql: string, params: unknown[]): Promise<number> {
    let id = cache.get(chave);
    if (!id) {
      id = await this.upsert(conn, sql, params);
      cache.set(chave, id);
    }
    return id;
  }

  /** Grava o lote de itens em um único INSERT multi-linha e confirma a transação. */
  private async gravarLote(conn: PoolConnection, lote: unknown[][]): Promise<void> {
    try {
      // co_seq_bps é UNIQUE: reimportar o mesmo arquivo atualiza em vez de duplicar.
      // id_usuario_insercao fica fora do UPDATE para preservar quem inseriu primeiro.
      const atualizar = COLS_ITEM.filter((c) => c !== 'co_seq_bps' && c !== 'id_usuario_insercao')
        .map((c) => `${c} = VALUES(${c})`).join(', ');
      await conn.query(
        `INSERT INTO item_compra (${COLS_ITEM.join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${atualizar}`,
        [lote],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  }
}
