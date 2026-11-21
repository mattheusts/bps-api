import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UsuarioToken } from '../auth/token';
import { DatabaseService } from '../database/database.service';
import { Coluna, TABELAS, TABELAS_POR_NOME, Tabela } from './tables';
import { validarCnpj } from './validacao';

export interface ParamsLista {
  q?: string;
  pagina?: string;
  tamanho?: string;
  ordem?: string;
  dir?: string;
}

/**
 * CRUD genérico. Todo identificador (tabela/coluna) que entra no SQL vem de TABELAS,
 * nunca da requisição; valores do usuário entram só como parâmetro "?".
 */
@Injectable()
export class CrudService {
  constructor(private readonly db: DatabaseService) {}

  /** Metadados das tabelas que o usuário pode ver, para o frontend montar telas e formulários. */
  meta(usuario: UsuarioToken) {
    return TABELAS.filter((t) => t.leitura.includes(usuario.perfil)).map((t) => ({
      nome: t.nome,
      rotulo: t.rotulo,
      pk: t.pk,
      podeEscrever: t.escrita.includes(usuario.perfil),
      colunas: t.colunas.map(({ nome, rotulo, tipo, obrigatorio, tamanho, opcoes, fk, auto, ocultaNaLista, cnpj }) => ({
        nome, rotulo, tipo, obrigatorio: !!obrigatorio, tamanho, opcoes, fk, auto, ocultaNaLista: !!ocultaNaLista, cnpj: !!cnpj,
      })),
    }));
  }

  async listar(nome: string, p: ParamsLista, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'leitura');
    const tamanho = Math.min(Math.max(Number(p.tamanho) || 20, 1), 100);
    const pagina = Math.max(Number(p.pagina) || 1, 1);
    const cols = t.colunas.filter((c) => !c.secreta && !c.ocultaNaLista);
    const ordem = cols.find((c) => c.nome === p.ordem)?.nome ?? t.ordem;
    const dir = p.dir === 'desc' ? 'DESC' : 'ASC';

    const { where, params } = this.filtroBusca(t, p.q);
    const select = this.selectComRotulos(t, cols);

    const [linhas, total] = await Promise.all([
      this.db.query(
        `SELECT ${select} FROM ${t.nome} t ${where} ORDER BY t.${ordem} ${dir}, t.${t.pk} ${dir} LIMIT ? OFFSET ?`,
        [...params, tamanho, (pagina - 1) * tamanho],
      ),
      this.db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t.nome} t ${where}`, params),
    ]);
    return { linhas, total: total?.n ?? 0, pagina, tamanho };
  }

  async obter(nome: string, id: string, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'leitura');
    const cols = t.colunas.filter((c) => !c.secreta);
    const linha = await this.db.one(`SELECT ${this.selectComRotulos(t, cols)} FROM ${t.nome} t WHERE t.${t.pk} = ?`, [id]);
    if (!linha) throw new NotFoundException('Registro não encontrado.');
    return linha;
  }

  /** Opções para um <select> de chave estrangeira, com busca. */
  async opcoes(nome: string, q: string | undefined, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'leitura');
    const { where, params } = this.filtroBusca(t, q, nome);
    // Sem alias: rotuloSql pode citar a tabela pelo nome (ver municipio).
    return this.db.query(
      `SELECT ${t.pk} AS id, ${t.rotuloSql} AS rotulo FROM ${t.nome} ${where} ORDER BY rotulo LIMIT 50`,
      params,
    );
  }

  async criar(nome: string, body: Record<string, unknown>, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'escrita');
    const dados = this.ler(t, body);
    for (const c of t.colunas) {
      if (c.auto === 'usuarioAtual') dados[c.nome] = usuario.id;
      if (c.auto === 'hoje') dados[c.nome] = new Date().toISOString().slice(0, 10);
    }
    t.antesDeGravar?.(dados, { criando: true, usuario });
    this.exigirObrigatorios(t, dados, true);

    const nomes = Object.keys(dados);
    const res = await this.db.execute(
      `INSERT INTO ${t.nome} (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`,
      nomes.map((n) => dados[n]),
    );
    return this.obter(nome, String(res.insertId), usuario);
  }

  async atualizar(nome: string, id: string, body: Record<string, unknown>, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'escrita');
    const dados = this.ler(t, body);
    t.antesDeGravar?.(dados, { criando: false, usuario });
    this.exigirObrigatorios(t, dados, false);

    const nomes = Object.keys(dados);
    if (nomes.length === 0) throw new BadRequestException('Nada para atualizar.');
    const res = await this.db.execute(
      `UPDATE ${t.nome} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE ${t.pk} = ?`,
      [...nomes.map((n) => dados[n]), id],
    );
    if (res.affectedRows === 0) throw new NotFoundException('Registro não encontrado.');
    return this.obter(nome, id, usuario);
  }

  async excluir(nome: string, id: string, usuario: UsuarioToken) {
    const t = this.tabela(nome, usuario, 'escrita');
    if (t.nome === 'usuario' && Number(id) === usuario.id) {
      throw new BadRequestException('Você não pode excluir o próprio usuário.');
    }
    const res = await this.db.execute(`DELETE FROM ${t.nome} WHERE ${t.pk} = ?`, [id]);
    if (res.affectedRows === 0) throw new NotFoundException('Registro não encontrado.');
  }

  // ---------------------------------------------------------------- auxiliares

  private tabela(nome: string, usuario: UsuarioToken, acesso: 'leitura' | 'escrita'): Tabela {
    const t = TABELAS_POR_NOME.get(nome);
    if (!t) throw new NotFoundException(`Tabela desconhecida: ${nome}`);
    if (!t[acesso].includes(usuario.perfil)) throw new ForbiddenException('Seu perfil não permite esta operação.');
    return t;
  }

  /** Colunas da tabela + "<fk>__rotulo" com o texto legível de cada chave estrangeira. */
  private selectComRotulos(t: Tabela, cols: Coluna[]): string {
    const partes = cols.map((c) => `t.${c.nome}`);
    for (const c of cols) {
      if (!c.fk) continue;
      const ref = TABELAS_POR_NOME.get(c.fk)!;
      partes.push(`(SELECT ${ref.rotuloSql} FROM ${ref.nome} WHERE ${ref.nome}.${ref.pk} = t.${c.nome}) AS ${c.nome}__rotulo`);
    }
    return partes.join(', ');
  }

  private filtroBusca(t: Tabela, q: string | undefined, prefixo = 't'): { where: string; params: unknown[] } {
    const termo = (q ?? '').trim();
    if (!termo) return { where: '', params: [] };
    const conds = t.busca.map((c) => `${prefixo}.${c} LIKE ?`);
    const params: unknown[] = t.busca.map(() => `%${termo}%`);
    if (/^\d+$/.test(termo)) {
      conds.push(`${prefixo}.${t.pk} = ?`);
      params.push(Number(termo));
      // códigos naturais numéricos (CATMAT, PDM, IBGE, BPS) também são buscáveis
      for (const c of t.colunas) {
        if (['co_catmat', 'co_pdm', 'co_ibge', 'co_seq_bps'].includes(c.nome)) {
          conds.push(`${prefixo}.${c.nome} = ?`);
          params.push(Number(termo));
        }
      }
    }
    return { where: `WHERE (${conds.join(' OR ')})`, params };
  }

  /** Converte e valida o corpo da requisição; ignora colunas automáticas e desconhecidas. */
  private ler(t: Tabela, body: Record<string, unknown>): Record<string, unknown> {
    const dados: Record<string, unknown> = {};
    for (const c of t.colunas) {
      if (c.auto || !(c.nome in (body ?? {}))) continue;
      dados[c.nome] = this.converter(c, body[c.nome]);
    }
    return dados;
  }

  private converter(c: Coluna, bruto: unknown): unknown {
    if (bruto === null || bruto === undefined || (typeof bruto === 'string' && bruto.trim() === '')) return null;
    const erro = (msg: string) => new BadRequestException(`${c.rotulo}: ${msg}`);
    const texto = String(bruto).trim();

    switch (c.tipo) {
      case 'int': {
        const n = Number(texto);
        if (!Number.isSafeInteger(n)) throw erro('deve ser um número inteiro.');
        return n;
      }
      case 'decimal': {
        const n = Number(texto.replace(',', '.'));
        if (!Number.isFinite(n)) throw erro('deve ser um número.');
        return n;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(Date.parse(texto))) throw erro('data inválida.');
        return texto;
      case 'flag':
        if (texto !== 'S' && texto !== 'N') throw erro("use 'S' ou 'N'.");
        return texto;
      case 'enum':
        if (!c.opcoes?.includes(texto)) throw erro(`use um destes valores: ${c.opcoes?.join(', ')}.`);
        return texto;
      case 'senha':
        return String(bruto); // sem trim: espaço pode fazer parte da senha
      default: {
        let v = texto;
        if (c.cnpj) {
          v = v.replace(/\D/g, '');
          if (!validarCnpj(v)) throw erro('dígitos verificadores não conferem.');
        }
        if (c.tamanho && v.length > c.tamanho) throw erro(`máximo de ${c.tamanho} caracteres.`);
        return v;
      }
    }
  }

  /** Na criação, todo obrigatório precisa vir; na edição, só não pode ser apagado (enviado vazio). */
  private exigirObrigatorios(t: Tabela, dados: Record<string, unknown>, criando: boolean): void {
    const faltando = t.colunas.filter(
      (c) => c.obrigatorio && !c.auto && (criando || c.nome in dados) && (dados[c.nome] === null || dados[c.nome] === undefined),
    );
    if (faltando.length) throw new BadRequestException(`Campos obrigatórios: ${faltando.map((c) => c.rotulo).join(', ')}.`);
  }
}
