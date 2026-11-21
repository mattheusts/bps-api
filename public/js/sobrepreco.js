// Dashboard 3: itens comprados muito acima da mediana nacional.
import { COR, api, barraFiltros, eixoCategoria, eixoMoeda, esc, fmt, grafico, kpis, tabela, truncar } from './util.js';

export async function telaSobrepreco(raiz) {
  const filtros = { ano: '', uf: '', esfera: '', tp_compra: '', fator: '1.5', min_amostra: '5', atipicos: '' };
  raiz.innerHTML = `
    <div class="cabecalho"><h2>Alerta de sobrepreço</h2>
      <span class="muted">Itens comprados acima de N × a mediana nacional do mesmo medicamento, unidade e ano</span></div>
    <div id="sp-filtros"></div>
    <div id="resultado"></div>`;

  const barra = await barraFiltros(['ano', 'uf', 'esfera', 'tp_compra'], filtros, () => carregar());
  barra.insertAdjacentHTML('beforeend', `
    <label>Acima de<select name="fator">
      ${['1.2', '1.5', '2', '3', '5', '10'].map((v) => `<option value="${v}" ${v === filtros.fator ? 'selected' : ''}>${v.replace('.', ',')}× a mediana</option>`).join('')}
    </select></label>
    <label title="Itens acima de 100× a mediana: quase sempre erro de digitação (ex.: preço total no campo de preço unitário)">
      Erros prováveis (&gt;100×)<select name="atipicos"><option value="">Ocultar</option><option value="incluir">Mostrar</option></select></label>
    <label>Mínimo de compras na referência<select name="min_amostra">
      ${['3', '5', '10', '20'].map((v) => `<option ${v === filtros.min_amostra ? 'selected' : ''}>${v}</option>`).join('')}
    </select></label>`);
  raiz.querySelector('#sp-filtros').appendChild(barra);

  async function carregar() {
    const el = raiz.querySelector('#resultado');
    el.innerHTML = '<p class="carregando">Calculando medianas…</p>';
    const r = await api('/dashboard/sobrepreco', { params: filtros });
    const s = r.resumo;
    el.innerHTML = `
      ${kpis([
        ['Itens acima do limite', fmt.int(s.qt_itens)],
        ['Pago a mais (estimado)', fmt.moedaCurta(s.vl_excedente), 'diferença para a mediana × quantidade'],
        ['Valor desses itens', fmt.moedaCurta(s.vl_pago)],
        ['Medicamentos envolvidos', fmt.int(s.qt_medicamentos)],
      ])}
      <div class="grade-2">
        <div class="cartao"><h3>Valor pago a mais por UF</h3><div class="grafico"><canvas id="g-sp-uf"></canvas></div></div>
        <div class="cartao"><h3>Fornecedores com maior valor acima da mediana</h3><div class="grafico"><canvas id="g-sp-forn"></canvas></div></div>
      </div>
      <div class="cartao">
        <h3>Itens, do maior para o menor valor pago a mais</h3>
        ${tabela([
          { titulo: 'Data', valor: (l) => fmt.data(l.dt_compra) },
          { titulo: 'Comprador', valor: (l) => `${esc(truncar(l.no_instituicao, 34))}<br><span class="muted">${esc(l.no_municipio)}/${esc(l.sg_uf)} · proc. ${esc(l.nu_processo_compra)}</span>` },
          { titulo: 'Medicamento', valor: (l) => `<a href="#/precos?catmat=${l.co_catmat}" title="${esc(l.ds_item)}">${esc(truncar(l.ds_item, 44))}</a><br><span class="muted">${esc(l.un || 'sem unidade')}</span>` },
          { titulo: 'Fornecedor', valor: (l) => esc(truncar(l.no_fornecedor, 28)) },
          { titulo: 'Qtd.', valor: (l) => fmt.int(l.qt_medicamento), num: true },
          { titulo: 'Preço pago', valor: (l) => fmt.preco(l.vl_preco_unitario), num: true },
          { titulo: 'Mediana', valor: (l) => `${fmt.preco(l.mediana)}<br><span class="muted">${l.n_amostra} compras</span>`, num: true },
          { titulo: '× mediana', valor: (l) => `<span class="selo alerta">${fmt.num(Math.round(l.razao * 10) / 10)}×</span>`, num: true },
          { titulo: 'Pago a mais', valor: (l) => fmt.moeda(l.vl_excedente), num: true },
        ], r.itens, 'Nenhum item acima do limite no recorte.')}
        <p class="nota">Itens acima de 100× a mediana quase sempre são erro de digitação no BPS (preço total no campo de preço unitário,
          unidade trocada) e ficam ocultos por padrão. Use "Erros prováveis: Mostrar" para listá-los e corrigi-los no cadastro.</p>
        <p class="nota">É um indício, não prova: preços diferentes podem vir de prazos, quantidades, logística ou compras judiciais urgentes.
          Mostrando até ${r.parametros.limite} itens.</p>
      </div>`;

    grafico('g-sp-uf', {
      type: 'bar',
      data: {
        labels: r.porUf.map((u) => u.sg_uf),
        datasets: [{ label: 'Pago a mais', data: r.porUf.map((u) => u.vl_excedente), backgroundColor: COR.serie[0], maxBarThickness: 32 }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (c) => `${fmt.moeda(c.raw)} em ${r.porUf[c.dataIndex].qt_itens} item(ns)`,
        } } },
        scales: { x: eixoCategoria, y: eixoMoeda },
      },
    });

    grafico('g-sp-forn', {
      type: 'bar',
      data: {
        labels: r.porFornecedor.map((f) => truncar(f.no_fornecedor, 32)),
        datasets: [{ label: 'Pago a mais', data: r.porFornecedor.map((f) => f.vl_excedente), backgroundColor: COR.serie[0], maxBarThickness: 22 }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (i) => r.porFornecedor[i[0].dataIndex].no_fornecedor,
          label: (c) => `${fmt.moeda(c.raw)} em ${r.porFornecedor[c.dataIndex].qt_itens} item(ns)`,
        } } },
        scales: { x: eixoMoeda, y: eixoCategoria },
      },
    });
  }

  carregar();
}
