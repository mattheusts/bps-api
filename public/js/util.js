// Utilitários compartilhados: API, formatação, DOM e gráficos.

// ------------------------------------------------------------------ API
const CHAVE_TOKEN = 'bps_token';

export const sessao = {
  get token() { try { return localStorage.getItem(CHAVE_TOKEN); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(CHAVE_TOKEN, v) : localStorage.removeItem(CHAVE_TOKEN); } catch { /* sem storage */ } },
  usuario: null,
};

export async function api(caminho, { metodo = 'GET', corpo, params } = {}) {
  const url = new URL(`/api${caminho}`, location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = {};
  if (sessao.token) headers.Authorization = `Bearer ${sessao.token}`;
  let body;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }

  const res = await fetch(url, { method: metodo, headers, body });
  if (res.status === 401 && !caminho.startsWith('/auth/login')) {
    sessao.token = null;
    location.reload();
    throw new Error('Sessão expirada.');
  }
  if (res.status === 204) return null;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(dados.message) ? dados.message.join(' ') : dados.message;
    throw new Error(msg || `Erro ${res.status}`);
  }
  return dados;
}

// ------------------------------------------------------------------ formatação
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompacto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

export const fmt = {
  moeda: (v) => (v === null || v === undefined ? '—' : brl.format(v)),
  moedaCurta: (v) => (v === null || v === undefined ? '—' : brlCompacto.format(v)),
  /** Preço unitário: até 4 casas, porque há itens de R$ 0,005. */
  preco: (v) => (v === null || v === undefined ? '—' : `R$ ${decimal.format(v)}`),
  int: (v) => (v === null || v === undefined ? '—' : inteiro.format(v)),
  num: (v) => (v === null || v === undefined ? '—' : decimal.format(v)),
  pct: (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`),
  data: (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'),
  mes: (v) => {
    const [a, m] = String(v).split('-');
    return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a.slice(2)}`;
  },
  cnpj: (v) => (v && v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v ?? '—'),
};

/** Remove acentos e pontuação para comparar nomes (ex.: "Ijuí" == "IJUI"). */
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// ------------------------------------------------------------------ DOM
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function aviso(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.className = `aviso${erro ? ' erro' : ''}`;
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => { el.hidden = true; }, erro ? 6000 : 3000);
}

export function kpis(lista) {
  return `<div class="kpis">${lista.map(([rotulo, valor, detalhe]) => `
    <div class="cartao kpi"><div class="rotulo">${esc(rotulo)}</div><div class="valor">${esc(valor)}</div>
    ${detalhe ? `<div class="detalhe">${esc(detalhe)}</div>` : ''}</div>`).join('')}</div>`;
}

/** Tabela simples a partir de colunas [{titulo, valor: (linha) => html, num?}]. */
export function tabela(colunas, linhas, vazio = 'Nenhum registro.') {
  if (!linhas.length) return `<p class="muted">${esc(vazio)}</p>`;
  return `<div class="tabela-wrap"><table><thead><tr>${colunas.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.titulo)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${colunas.map((c) => `<td class="${c.num ? 'num' : ''}">${c.valor(l)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Campo de busca com sugestões. buscar(q) devolve [{valor, texto}]; escolher(item) é chamado ao clicar. */
export function autocomplete(input, buscar, escolher) {
  const lista = document.createElement('div');
  lista.className = 'auto-lista';
  lista.hidden = true;
  input.parentElement.classList.add('auto');
  input.parentElement.appendChild(lista);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const itens = await buscar(input.value).catch(() => []);
      lista.innerHTML = itens.map((it, i) => `<div data-i="${i}">${esc(it.texto)}</div>`).join('');
      lista.hidden = itens.length === 0;
      lista.onclick = (ev) => {
        const i = ev.target.closest('[data-i]')?.dataset.i;
        if (i === undefined) return;
        lista.hidden = true;
        escolher(itens[Number(i)]);
      };
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 200));
}

// ------------------------------------------------------------------ filtros dos dashboards
let cacheFiltros;
export async function opcoesFiltros() {
  cacheFiltros ??= await api('/dashboard/filtros');
  return cacheFiltros;
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/** Monta selects de filtro. campos: lista de 'ano' | 'uf' | 'esfera' | 'tp_compra'. */
export async function barraFiltros(campos, valores, aoMudar) {
  const op = await opcoesFiltros();
  const sel = (nome, rotulo, opcoes) => `<label>${rotulo}<select name="${nome}"><option value="">Todos</option>
    ${opcoes.map((o) => `<option value="${esc(o)}" ${String(valores[nome] ?? '') === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const html = campos.map((c) => ({
    ano: () => sel('ano', 'Ano', op.anos),
    uf: () => sel('uf', 'UF', UFS),
    esfera: () => sel('esfera', 'Esfera', op.esferas),
    tp_compra: () => sel('tp_compra', 'Tipo de compra', op.tipos),
    atipicos: () => `<label title="Itens com preço unitário acima de 100× a mediana do mesmo medicamento: quase sempre erro de digitação no BPS">
      Preços atípicos (&gt;100× a mediana)<select name="atipicos">
      <option value="">Excluir dos totais</option><option value="incluir" ${valores.atipicos === 'incluir' ? 'selected' : ''}>Incluir</option></select></label>`,
  }[c]())).join('');
  const div = document.createElement('div');
  div.className = 'filtros';
  div.innerHTML = html;
  div.addEventListener('change', (ev) => {
    if (ev.target.name) { valores[ev.target.name] = ev.target.value; aoMudar(); }
  });
  return div;
}

// ------------------------------------------------------------------ gráficos (Chart.js)
export const COR = {
  serie: ['#2a78d6', '#eb6834', '#1baf7a'], // slots categóricos 1-3 (validados em todos os pares)
  grade: '#e1e0d9',
  eixo: '#c3c2b7',
  texto2: '#52514e',
  mudo: '#898781',
  semDado: '#f0efec',
  // rampa sequencial azul (claro -> escuro), 7 classes
  sequencial: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
};

if (window.Chart) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = COR.texto2;
  Chart.defaults.borderColor = COR.grade;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.tooltip.mode = 'index';
  Chart.defaults.plugins.tooltip.intersect = false;
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 6;
}

const graficos = new Map();
/** Cria (ou recria) um gráfico no canvas com esse id. */
export function grafico(id, config) {
  graficos.get(id)?.destroy();
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return null;
  const g = new Chart(canvas, config);
  graficos.set(id, g);
  return g;
}

/** Eixo de valor em reais, compacto. */
export const eixoMoeda = { ticks: { callback: (v) => fmt.moedaCurta(v) }, grid: { color: COR.grade }, border: { display: false } };
export const eixoCategoria = { grid: { display: false }, border: { color: COR.eixo } };
export const truncar = (s, n = 40) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
