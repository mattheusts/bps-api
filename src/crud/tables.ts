import { BadRequestException } from '@nestjs/common';
import { hashSenha } from '../auth/password';
import { Perfil, UsuarioToken } from '../auth/token';

export type TipoColuna = 'int' | 'decimal' | 'string' | 'text' | 'date' | 'datetime' | 'flag' | 'enum' | 'senha';

export interface Coluna {
  nome: string;
  rotulo: string;
  tipo: TipoColuna;
  obrigatorio?: boolean;
  tamanho?: number;
  opcoes?: string[]; // para tipo enum
  fk?: string; // nome da tabela referenciada
  cnpj?: boolean;
  /** Preenchida pelo sistema; não aparece no formulário. */
  auto?: 'pk' | 'usuarioAtual' | 'hoje' | 'banco';
  /** Fica fora da listagem (ex.: textos longos). */
  ocultaNaLista?: boolean;
  /** Nunca é devolvida pela API (ex.: hash de senha). */
  secreta?: boolean;
}

export interface Tabela {
  nome: string;
  rotulo: string;
  pk: string;
  /** Expressão SQL que identifica uma linha nos selects de FK (colunas da própria tabela). */
  rotuloSql: string;
  busca: string[];
  ordem: string;
  leitura: Perfil[];
  escrita: Perfil[];
  colunas: Coluna[];
  /** Ajustes antes de gravar (hash de senha, total calculado...). */
  antesDeGravar?: (dados: Record<string, unknown>, ctx: { criando: boolean; usuario: UsuarioToken }) => void;
}

const TODOS: Perfil[] = ['ADMIN', 'OPERADOR', 'CONSULTA'];
const EDITORES: Perfil[] = ['ADMIN', 'OPERADOR'];
const pk = (nome: string): Coluna => ({ nome, rotulo: 'ID', tipo: 'int', auto: 'pk' });

export const TABELAS: Tabela[] = [
  {
    nome: 'estado', rotulo: 'Estados', pk: 'id_estado',
    rotuloSql: "CONCAT(sg_uf, ' - ', no_estado)", busca: ['sg_uf', 'no_estado'], ordem: 'sg_uf',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_estado'),
      { nome: 'sg_uf', rotulo: 'UF', tipo: 'string', tamanho: 2, obrigatorio: true },
      { nome: 'no_estado', rotulo: 'Nome', tipo: 'string', tamanho: 30, obrigatorio: true },
    ],
    antesDeGravar: (d) => { if (typeof d.sg_uf === 'string') d.sg_uf = d.sg_uf.toUpperCase(); },
  },
  {
    nome: 'municipio', rotulo: 'Municípios', pk: 'id_municipio',
    rotuloSql: "CONCAT(no_municipio, ' / ', (SELECT e.sg_uf FROM estado e WHERE e.id_estado = municipio.id_estado))",
    busca: ['no_municipio'], ordem: 'no_municipio',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_municipio'),
      { nome: 'no_municipio', rotulo: 'Nome', tipo: 'string', tamanho: 60, obrigatorio: true },
      { nome: 'id_estado', rotulo: 'Estado', tipo: 'int', fk: 'estado', obrigatorio: true },
      { nome: 'co_ibge', rotulo: 'Código IBGE', tipo: 'int' },
    ],
  },
  {
    nome: 'fabricante', rotulo: 'Fabricantes', pk: 'id_fabricante',
    rotuloSql: 'no_fabricante', busca: ['cnpj_fabricante', 'no_fabricante'], ordem: 'no_fabricante',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_fabricante'),
      { nome: 'cnpj_fabricante', rotulo: 'CNPJ', tipo: 'string', tamanho: 14, obrigatorio: true, cnpj: true },
      { nome: 'no_fabricante', rotulo: 'Nome', tipo: 'string', tamanho: 150, obrigatorio: true },
    ],
  },
  {
    nome: 'fornecedor', rotulo: 'Fornecedores', pk: 'id_fornecedor',
    rotuloSql: 'no_fornecedor', busca: ['cnpj_fornecedor', 'no_fornecedor'], ordem: 'no_fornecedor',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_fornecedor'),
      { nome: 'cnpj_fornecedor', rotulo: 'CNPJ', tipo: 'string', tamanho: 14, obrigatorio: true, cnpj: true },
      { nome: 'no_fornecedor', rotulo: 'Nome', tipo: 'string', tamanho: 150, obrigatorio: true },
    ],
  },
  {
    nome: 'instituicao', rotulo: 'Instituições', pk: 'id_instituicao',
    rotuloSql: 'no_instituicao', busca: ['cnpj_instituicao', 'no_instituicao'], ordem: 'no_instituicao',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_instituicao'),
      { nome: 'cnpj_instituicao', rotulo: 'CNPJ', tipo: 'string', tamanho: 14, obrigatorio: true, cnpj: true },
      { nome: 'no_instituicao', rotulo: 'Nome', tipo: 'string', tamanho: 150, obrigatorio: true },
      { nome: 'ds_esfera', rotulo: 'Esfera', tipo: 'enum', opcoes: ['MUNICIPAL', 'ESTADUAL', 'FEDERAL'], obrigatorio: true },
      { nome: 'id_municipio', rotulo: 'Município', tipo: 'int', fk: 'municipio', obrigatorio: true },
    ],
  },
  {
    nome: 'usuario', rotulo: 'Usuários', pk: 'id_usuario',
    rotuloSql: 'no_usuario', busca: ['no_usuario', 'ds_email'], ordem: 'no_usuario',
    leitura: ['ADMIN'], escrita: ['ADMIN'],
    colunas: [
      pk('id_usuario'),
      { nome: 'no_usuario', rotulo: 'Nome', tipo: 'string', tamanho: 150, obrigatorio: true },
      { nome: 'ds_email', rotulo: 'E-mail', tipo: 'string', tamanho: 150, obrigatorio: true },
      // Campo virtual "senha": o formulário envia a senha e o hook grava o hash em ds_senha_hash.
      { nome: 'ds_senha_hash', rotulo: 'Senha', tipo: 'senha', secreta: true },
      { nome: 'tp_perfil', rotulo: 'Perfil', tipo: 'enum', opcoes: ['ADMIN', 'OPERADOR', 'CONSULTA'], obrigatorio: true },
      { nome: 'fg_ativo', rotulo: 'Ativo', tipo: 'flag', obrigatorio: true },
      { nome: 'id_instituicao', rotulo: 'Instituição', tipo: 'int', fk: 'instituicao' },
      { nome: 'dt_cadastro', rotulo: 'Cadastro', tipo: 'datetime', auto: 'banco' },
    ],
    antesDeGravar: (d, { criando }) => {
      if (typeof d.ds_email === 'string') d.ds_email = d.ds_email.trim().toLowerCase();
      const senha = d.ds_senha_hash;
      if (typeof senha === 'string' && senha.length > 0) {
        if (senha.length < 8) throw new BadRequestException('A senha precisa ter pelo menos 8 caracteres.');
        d.ds_senha_hash = hashSenha(senha);
      } else if (criando) {
        throw new BadRequestException('Informe a senha.');
      } else {
        delete d.ds_senha_hash; // edição sem senha mantém a atual
      }
    },
  },
  {
    nome: 'pdm', rotulo: 'PDM', pk: 'id_pdm',
    rotuloSql: "CONCAT(co_pdm, ' - ', no_pdm)", busca: ['no_pdm', 'no_classe'], ordem: 'no_pdm',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_pdm'),
      { nome: 'co_pdm', rotulo: 'Código PDM', tipo: 'int', obrigatorio: true },
      { nome: 'no_pdm', rotulo: 'Nome', tipo: 'string', tamanho: 60, obrigatorio: true },
      { nome: 'co_classe', rotulo: 'Código classe', tipo: 'int', obrigatorio: true },
      { nome: 'no_classe', rotulo: 'Classe', tipo: 'string', tamanho: 100, obrigatorio: true },
    ],
  },
  {
    nome: 'medicamento', rotulo: 'Medicamentos (CATMAT)', pk: 'id_medicamento',
    rotuloSql: "CONCAT(co_catmat, ' - ', LEFT(ds_item, 80))", busca: ['ds_item'], ordem: 'ds_item',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_medicamento'),
      { nome: 'co_catmat', rotulo: 'CATMAT', tipo: 'int', obrigatorio: true },
      { nome: 'ds_item', rotulo: 'Descrição', tipo: 'string', tamanho: 600, obrigatorio: true },
      { nome: 'id_pdm', rotulo: 'PDM', tipo: 'int', fk: 'pdm', obrigatorio: true },
    ],
  },
  {
    nome: 'processo_compra', rotulo: 'Processos de compra', pk: 'id_processo_compra',
    rotuloSql: "CONCAT(nu_processo_compra, ' (', DATE_FORMAT(dt_compra, '%d/%m/%Y'), ')')",
    busca: ['nu_processo_compra', 'nu_ata', 'modalidade'], ordem: 'dt_compra',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_processo_compra'),
      { nome: 'id_instituicao', rotulo: 'Instituição', tipo: 'int', fk: 'instituicao', obrigatorio: true },
      { nome: 'nu_processo_compra', rotulo: 'Nº processo', tipo: 'string', tamanho: 30, obrigatorio: true },
      { nome: 'nu_ata', rotulo: 'Nº ata', tipo: 'string', tamanho: 30 },
      { nome: 'ano_compra', rotulo: 'Ano', tipo: 'int', obrigatorio: true },
      { nome: 'dt_compra', rotulo: 'Data da compra', tipo: 'date', obrigatorio: true },
      { nome: 'tp_compra', rotulo: 'Tipo', tipo: 'enum', opcoes: ['ADMINISTRATIVA', 'JUDICIAL'], obrigatorio: true },
      { nome: 'modalidade', rotulo: 'Modalidade', tipo: 'string', tamanho: 40, obrigatorio: true },
      { nome: 'validade_compra', rotulo: 'Validade (meses)', tipo: 'int', obrigatorio: true },
      { nome: 'id_usuario_cadastro', rotulo: 'Cadastrado por', tipo: 'int', fk: 'usuario', auto: 'usuarioAtual' },
    ],
    antesDeGravar: (d) => {
      // ano_compra é redundante com dt_compra; se vier vazio, deriva da data.
      if ((d.ano_compra === null || d.ano_compra === undefined) && typeof d.dt_compra === 'string') {
        d.ano_compra = Number(d.dt_compra.slice(0, 4));
      }
    },
  },
  {
    nome: 'item_compra', rotulo: 'Itens de compra', pk: 'id_item_compra',
    rotuloSql: 'CAST(co_seq_bps AS CHAR)', busca: ['registro_anvisa', 'un_fornecimento'], ordem: 'id_item_compra',
    leitura: TODOS, escrita: EDITORES,
    colunas: [
      pk('id_item_compra'),
      { nome: 'co_seq_bps', rotulo: 'Cód. BPS', tipo: 'int', obrigatorio: true },
      { nome: 'id_processo_compra', rotulo: 'Processo', tipo: 'int', fk: 'processo_compra', obrigatorio: true },
      { nome: 'id_medicamento', rotulo: 'Medicamento', tipo: 'int', fk: 'medicamento', obrigatorio: true },
      { nome: 'id_fornecedor', rotulo: 'Fornecedor', tipo: 'int', fk: 'fornecedor', obrigatorio: true },
      { nome: 'id_fabricante', rotulo: 'Fabricante', tipo: 'int', fk: 'fabricante', obrigatorio: true },
      { nome: 'qt_medicamento', rotulo: 'Quantidade', tipo: 'int', obrigatorio: true },
      { nome: 'vl_preco_unitario', rotulo: 'Preço unitário', tipo: 'decimal', obrigatorio: true },
      { nome: 'vl_preco_total', rotulo: 'Preço total', tipo: 'decimal' },
      { nome: 'un_fornecimento', rotulo: 'Unid. fornecimento', tipo: 'string', tamanho: 20 },
      { nome: 'fg_generico', rotulo: 'Genérico', tipo: 'flag' },
      { nome: 'registro_anvisa', rotulo: 'Registro ANVISA', tipo: 'string', tamanho: 20, ocultaNaLista: true },
      { nome: 'un_medida_capacidade', rotulo: 'Capacidade (unid.)', tipo: 'string', tamanho: 30, ocultaNaLista: true },
      { nome: 'sg_unidade_medida', rotulo: 'Unid. medida', tipo: 'string', tamanho: 10, ocultaNaLista: true },
      { nome: 'vl_capacidade', rotulo: 'Capacidade', tipo: 'decimal', ocultaNaLista: true },
      { nome: 'ds_observacao', rotulo: 'Observação', tipo: 'text', ocultaNaLista: true },
      { nome: 'dt_insercao', rotulo: 'Inserido em', tipo: 'date', auto: 'hoje' },
      { nome: 'id_usuario_insercao', rotulo: 'Inserido por', tipo: 'int', fk: 'usuario', auto: 'usuarioAtual' },
    ],
    antesDeGravar: (d) => {
      const qt = d.qt_medicamento, pu = d.vl_preco_unitario;
      if ((d.vl_preco_total === null || d.vl_preco_total === undefined) && typeof qt === 'number' && typeof pu === 'number') {
        d.vl_preco_total = Math.round(qt * pu * 100) / 100;
      }
    },
  },
];

export const TABELAS_POR_NOME = new Map(TABELAS.map((t) => [t.nome, t]));
