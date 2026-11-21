// Dashboard 2: preço de referência de um medicamento (CATMAT + unidade de fornecimento).
import { COR, api, autocomplete, barraFiltros, eixoCategoria, esc, fmt, grafico, kpis, tabela, truncar } from './util.js';

export async function telaPrecos(raiz, params) {
  const estado = { filtros: { ano: params.ano ?? '', esfera: '', tp_compra: '' }, catmat: params.catmat ?? '', un: undefined };
  raiz.innerHTML = `
    <div class="cabecalho"><h2>Preço de referência</h2>
      <span class="muted">Quanto o poder público paga por um medicamento, por estado e ao longo do tempo</span></div>
    <div class="filtros" id="busca">
      <label style="min-width:420px">Medicamento (nome ou CATMAT)<input id="busca-med" placeholder="ex.: amoxicilina, 267510" autocomplete="off"></label>
      <label>Unidade de fornecimento<select id="unidade" disabled></select></label>
    </div>
    <div id="precos-filtros"></div>
    <div id="resultado"><p class="muted">Escolha um medicamento.</p></div>`;

  raiz.querySelector('#precos-filtros').appendChild(
    await barraFiltros(['ano', 'esfera', 'tp_compra'], estado.filtros, () => carregarUnidades()),
  );

  const inputMed = raiz.querySelector('#busca-med');
  autocomplete(
    inputMed,
    async (q) => (await api('/dashboard/medicamentos', { params: { q } })).map((m) => ({
      valor: m.co_catmat, texto: `${m.co_catmat} · ${truncar(m.ds_item, 90)} (${m.n} compras)`, ds: m.ds_item,
    })),
    (it) => { inputMed.value = `${it.valor} · ${truncar(it.ds, 80)}`; estado.catmat = it.valor; estado.un = undefined; carregarUnidades(); },
  );
  if (estado.catmat) { inputMed.value = estado.catmat; carregarUnidades(); }

  const selUn = raiz.querySelector('#unidade');
  selUn.addEventListener('change', () => { estado.un = selUn.value; carregar(); });

  async function carregarUnidades() {
    if (!estado.catmat) return;
    const uns = await api(`/dashboard/precos/${estado.catmat}/unidades`, { params: estado.filtros });
    if (!uns.length) {
      selUn.disabled = true; selUn.innerHTML = '';
      raiz.querySelector('#resultado').innerHTML = '<p class="muted">Nenhuma compra desse medicamento no recorte.</p>';
      return;
    }
    // Preço só é comparável dentro da mesma unidade: começa pela mais frequente.
    if (estado.un === undefined || !uns.some((u) => u.un === estado.un)) estado.un = uns[0].un;
    selUn.innerHTML = uns.map((u) => `<option value="${esc(u.un)}" ${u.un === estado.un ? 'selected' : ''}>${esc(u.un || '(não informada)')} — ${u.n} compras</option>`).join('');
    selUn.disabled = uns.length < 2;
    carregar();
  }

  async function carregar() {
    const el = raiz.querySelector('#resultado');
    el.innerHTML = '<p class="carregando">Calculando…</p>';
    const r = await api(`/dashboard/precos/${estado.catmat}`, { params: { ...estado.filtros, un: estado.un === '' ? '(vazio)' : estado.un } });
    const g = r.geral;
    if (!g || !g.n) { el.innerHTML = '<p class="muted">Sem compras no recorte.</p>'; return; }
    if (r.medicamento) inputMed.value = `${r.medicamento.co_catmat} · ${truncar(r.medicamento.ds_item, 80)}`;

    el.innerHTML = `
      ${kpis([
        ['Compras', fmt.int(g.n)],
        ['Mediana', fmt.preco(g.mediana), `p25 ${fmt.preco(g.p25)} · p75 ${fmt.preco(g.p75)}`],
        ['Média ponderada', fmt.preco(g.media_ponderada), 'pela quantidade comprada'],
        ['Menor preço', fmt.preco(g.minimo)],
        ['Maior preço', fmt.preco(g.maximo), `${fmt.num(g.maximo / g.mediana)}× a mediana`],
      ])}
      <div class="grade-2">
        <div class="cartao"><h3>Preço mediano por UF</h3><div class="grafico"><canvas id="g-uf"></canvas></div>
          <p class="nota">A linha laranja é a mediana nacional. Estados com uma ou duas compras têm mediana pouco confiável.</p></div>
        <div class="cartao"><h3>Evolução mensal do preço</h3><div class="grafico"><canvas id="g-mes"></canvas></div></div>
      </div>
      <div class="grade-2">
        <div class="cartao"><h3>Por fornecedor</h3>${tabela([
          { titulo: 'Fornecedor', valor: (l) => esc(truncar(l.no_fornecedor, 40)) },
          { titulo: 'Compras', valor: (l) => fmt.int(l.n), num: true },
          { titulo: 'Mediana', valor: (l) => fmt.preco(l.mediana), num: true },
          { titulo: 'Mín.', valor: (l) => fmt.preco(l.minimo), num: true },
          { titulo: 'Máx.', valor: (l) => fmt.preco(l.maximo), num: true },
        ], r.porFornecedor)}</div>
        <div class="cartao"><h3>Compras mais caras</h3>${tabela([
          { titulo: 'Data', valor: (l) => fmt.data(l.dt_compra) },
          { titulo: 'Comprador', valor: (l) => `${esc(truncar(l.no_instituicao, 30))}<br><span class="muted">${esc(l.no_municipio)}/${esc(l.sg_uf)}</span>` },
          { titulo: 'Qtd.', valor: (l) => fmt.int(l.qt_medicamento), num: true },
          { titulo: 'Preço', valor: (l) => fmt.preco(l.vl_preco_unitario), num: true },
          { titulo: '× mediana', valor: (l) => {
            const x = l.vl_preco_unitario / g.mediana;
            return `<span class="selo ${x >= 1.5 ? 'alerta' : ''}">${fmt.num(Math.round(x * 10) / 10)}×</span>`;
          }, num: true },
        ], r.compras.slice(0, 15))}</div>
      </div>`;

    grafico('g-uf', {
      data: {
        labels: r.porUf.map((u) => u.sg_uf),
        datasets: [
          { type: 'bar', label: 'Mediana da UF', data: r.porUf.map((u) => u.mediana), backgroundColor: COR.serie[0], maxBarThickness: 28 },
          { type: 'line', label: 'Mediana nacional', data: r.porUf.map(() => g.mediana), borderColor: COR.serie[1], pointRadius: 0, borderDash: [6, 4] },
        ],
      },
      options: {
        scales: { x: eixoCategoria, y: { beginAtZero: true, ticks: { callback: (v) => fmt.preco(v) } } },
        plugins: { tooltip: { callbacks: {
          label: (c) => `${c.dataset.label}: ${fmt.preco(c.raw)}`,
          afterBody: (itens) => { const u = r.porUf[itens[0].dataIndex]; return `${u.n} compra(s) · min ${fmt.preco(u.minimo)} · máx ${fmt.preco(u.maximo)}`; },
        } } },
      },
    });

    grafico('g-mes', {
      type: 'line',
      data: {
        labels: r.porMes.map((m) => fmt.mes(m.mes)),
        datasets: [
          { label: 'Mediana', data: r.porMes.map((m) => m.mediana), borderColor: COR.serie[0], backgroundColor: COR.serie[0] },
          { label: 'Média ponderada', data: r.porMes.map((m) => m.media_ponderada), borderColor: COR.serie[1], backgroundColor: COR.serie[1] },
        ],
      },
      options: {
        scales: { x: eixoCategoria, y: { beginAtZero: true, ticks: { callback: (v) => fmt.preco(v) } } },
        plugins: { tooltip: { callbacks: {
          label: (c) => `${c.dataset.label}: ${fmt.preco(c.raw)}`,
          footer: (itens) => `${r.porMes[itens[0].dataIndex].n} compra(s)`,
        } } },
      },
    });
  }
}
