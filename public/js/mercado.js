// Dashboard 4: estrutura do mercado (fornecedores, fabricantes, genéricos, modalidades).
import { COR, api, barraFiltros, eixoCategoria, eixoMoeda, fmt, grafico, kpis, truncar } from './util.js';

const NOME_GENERICO = { S: 'Genérico', N: 'Não genérico', I: 'Não informado' };

/** Leitura do HHI pelas faixas usuais de defesa da concorrência. */
function leituraHhi(h) {
  if (h < 1500) return 'pouco concentrado';
  if (h <= 2500) return 'moderadamente concentrado';
  return 'muito concentrado';
}

export async function telaMercado(raiz) {
  const filtros = { ano: '', uf: '', esfera: '', tp_compra: '' };
  raiz.innerHTML = `
    <div class="cabecalho"><h2>Mercado e fornecedores</h2>
      <span class="muted">Quem vende, quem fabrica e como o poder público compra</span></div>
    <div id="m-filtros"></div>
    <div id="resultado"></div>`;
  raiz.querySelector('#m-filtros').appendChild(await barraFiltros(['ano', 'uf', 'esfera', 'tp_compra', 'atipicos'], filtros, () => carregar()));

  async function carregar() {
    const el = raiz.querySelector('#resultado');
    el.innerHTML = '<p class="carregando">Carregando…</p>';
    const r = await api('/dashboard/mercado', { params: filtros });
    const total = r.hhi.vl_total || 1;
    const top10 = r.fornecedores.reduce((s, f) => s + f.vl_total, 0);
    const gen = Object.fromEntries(r.genericos.map((g) => [g.fg_generico, g]));
    const informado = (gen.S?.vl_total ?? 0) + (gen.N?.vl_total ?? 0);

    el.innerHTML = `
      ${kpis([
        ['Valor total', fmt.moedaCurta(r.hhi.vl_total)],
        ['Fornecedores', fmt.int(r.hhi.qt_fornecedores)],
        ['Participação dos 10 maiores', fmt.pct(top10 / total)],
        ['Concentração (HHI)', fmt.int(r.hhi.hhi), leituraHhi(r.hhi.hhi)],
        ['Genéricos', informado ? fmt.pct((gen.S?.vl_total ?? 0) / informado) : '—', 'do valor com a informação preenchida'],
      ])}
      <div class="grade-2">
        <div class="cartao"><h3>10 maiores fornecedores</h3><div class="grafico alto"><canvas id="g-forn"></canvas></div></div>
        <div class="cartao"><h3>10 maiores fabricantes</h3><div class="grafico alto"><canvas id="g-fab"></canvas></div></div>
      </div>
      <div class="grade-3">
        <div class="cartao"><h3>Valor por modalidade</h3><div class="grafico"><canvas id="g-mod"></canvas></div></div>
        <div class="cartao"><h3>Esfera e tipo de compra</h3><div class="grafico"><canvas id="g-esf"></canvas></div></div>
        <div class="cartao"><h3>Genérico ou não</h3><div class="grafico"><canvas id="g-gen"></canvas></div>
          <p class="nota">${fmt.pct((gen.I?.vl_total ?? 0) / total)} do valor não informa se o item é genérico.</p></div>
      </div>
      <div class="cartao"><h3>Valor comprado por mês</h3><div class="grafico"><canvas id="g-mes"></canvas></div>
        <p class="nota">Pela data da compra. Os meses mais recentes tendem a crescer conforme novas compras são inseridas no BPS.</p></div>`;

    const barrasH = (id, linhas) => grafico(id, {
      type: 'bar',
      data: {
        labels: linhas.map((l) => truncar(l.nome, 34)),
        datasets: [{ label: 'Valor', data: linhas.map((l) => l.vl_total), backgroundColor: COR.serie[0], maxBarThickness: 22 }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (i) => linhas[i[0].dataIndex].nome,
          label: (c) => `${fmt.moeda(c.raw)} · ${fmt.pct(c.raw / total)} do total · ${fmt.int(linhas[c.dataIndex].qt_itens)} itens`,
        } } },
        scales: { x: eixoMoeda, y: eixoCategoria },
      },
    });
    barrasH('g-forn', r.fornecedores);
    barrasH('g-fab', r.fabricantes);

    grafico('g-mod', {
      type: 'bar',
      data: { labels: r.modalidades.map((m) => m.nome), datasets: [{ label: 'Valor', data: r.modalidades.map((m) => m.vl_total), backgroundColor: COR.serie[0], maxBarThickness: 40 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt.moeda(c.raw)} · ${r.modalidades[c.dataIndex].qt_processos} processos` } } },
        scales: { x: eixoCategoria, y: eixoMoeda },
      },
    });

    // Esfera × tipo: barras agrupadas, uma série por tipo de compra (no máximo 3 cores).
    const esferas = [...new Set(r.esferas.map((e) => e.nome))];
    const tipos = [...new Set(r.esferas.map((e) => e.tp_compra))];
    grafico('g-esf', {
      type: 'bar',
      data: {
        labels: esferas,
        datasets: tipos.map((t, i) => ({
          label: t,
          data: esferas.map((e) => r.esferas.find((x) => x.nome === e && x.tp_compra === t)?.vl_total ?? 0),
          backgroundColor: COR.serie[i % COR.serie.length],
          maxBarThickness: 40,
        })),
      },
      options: { scales: { x: eixoCategoria, y: eixoMoeda }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.moeda(c.raw)}` } } } },
    });

    const ordemGen = ['S', 'N', 'I'].filter((k) => gen[k]);
    grafico('g-gen', {
      type: 'bar',
      data: {
        labels: ordemGen.map((k) => NOME_GENERICO[k]),
        datasets: [{ label: 'Valor', data: ordemGen.map((k) => gen[k].vl_total), backgroundColor: ordemGen.map((_, i) => COR.serie[i]), maxBarThickness: 40 }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt.moeda(c.raw)} · ${fmt.pct(c.raw / total)} · ${fmt.int(gen[ordemGen[c.dataIndex]].qt_itens)} itens` } } },
        scales: { x: eixoCategoria, y: eixoMoeda },
      },
    });

    grafico('g-mes', {
      type: 'line',
      data: { labels: r.mensal.map((m) => fmt.mes(m.mes)), datasets: [{ label: 'Valor', data: r.mensal.map((m) => m.vl_total), borderColor: COR.serie[0], backgroundColor: COR.serie[0] }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt.moeda(c.raw)} · ${fmt.int(r.mensal[c.dataIndex].qt_itens)} itens` } } },
        scales: { x: eixoCategoria, y: { ...eixoMoeda, beginAtZero: true } },
      },
    });
    el.querySelectorAll('canvas').forEach((c) => c.setAttribute('role', 'img'));
  }

  carregar();
}
