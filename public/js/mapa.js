// Dashboard 1: mapa coroplético por estado, com drill-down para municípios.
import { COR, api, barraFiltros, esc, fmt, kpis, normalizar, truncar } from './util.js';

// Código IBGE de cada UF (as malhas do IBGE identificam áreas por esse código).
const UF_IBGE = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
const IBGE_UF = Object.fromEntries(Object.entries(UF_IBGE).map(([uf, cod]) => [String(cod), uf]));
const MALHAS = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const GEO = 'formato=application/vnd.geo+json&qualidade=minima';

const METRICAS = {
  vl_total: { rotulo: 'Valor total', fmt: fmt.moedaCurta },
  qt_itens: { rotulo: 'Itens comprados', fmt: fmt.int },
  qt_processos: { rotulo: 'Processos', fmt: fmt.int },
  qt_instituicoes: { rotulo: 'Instituições', fmt: fmt.int },
};

// Malhas e listas de municípios do IBGE mudam raramente: guarda durante a sessão.
const cacheGeo = new Map();
async function buscarJson(url) {
  if (!cacheGeo.has(url)) {
    cacheGeo.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`IBGE respondeu ${r.status}`);
      return r.json();
    }).catch((e) => { cacheGeo.delete(url); throw e; }));
  }
  return cacheGeo.get(url);
}

export async function telaMapa(raiz) {
  const estado = { filtros: {}, metrica: 'vl_total', uf: null, municipio: null };
  raiz.innerHTML = `
    <div class="cabecalho"><h2>Compras por localidade</h2>
      <span class="muted">Clique em um estado para ver os municípios</span></div>
    <div id="mapa-filtros"></div>
    <div class="mapa-layout">
      <div class="cartao">
        <div class="trilha" id="trilha"></div>
        <div id="mapa"></div>
        <p class="nota" id="mapa-nota"></p>
      </div>
      <div id="painel"></div>
    </div>`;

  const barra = await barraFiltros(['ano', 'esfera', 'tp_compra', 'atipicos'], estado.filtros, () => desenhar());
  barra.insertAdjacentHTML('beforeend', `<label>Colorir por<select name="metrica">
    ${Object.entries(METRICAS).map(([k, m]) => `<option value="${k}">${m.rotulo}</option>`).join('')}</select></label>`);
  barra.querySelector('[name=metrica]').addEventListener('change', (ev) => {
    ev.stopPropagation();
    estado.metrica = ev.target.value;
    desenhar();
  });
  raiz.querySelector('#mapa-filtros').appendChild(barra);

  if (!window.L) {
    raiz.querySelector('#mapa').innerHTML = '<p class="erro" style="padding:16px">Leaflet não carregou (sem internet?). O painel ao lado continua funcionando.</p>';
  }
  const mapa = window.L ? L.map('mapa', { zoomSnap: 0.25, attributionControl: false }) : null;
  let camada = null;
  let legenda = null;

  async function desenhar() {
    const { filtros, metrica, uf } = estado;
    trilha();
    painel();
    if (!mapa) return;
    const nota = raiz.querySelector('#mapa-nota');
    nota.textContent = 'Carregando malha do IBGE…';
    try {
      if (!uf) {
        const [geo, dados] = await Promise.all([
          buscarJson(`${MALHAS}/paises/BR?intrarregiao=UF&${GEO}`),
          api('/dashboard/mapa/estados', { params: filtros }),
        ]);
        const porUf = new Map(dados.map((d) => [d.sg_uf, d]));
        pintar(geo, (f) => porUf.get(IBGE_UF[f.properties.codarea]), (f, d) => ({ nome: d?.no_estado ?? IBGE_UF[f.properties.codarea], d }),
          (f) => { estado.uf = IBGE_UF[f.properties.codarea]; estado.municipio = null; desenhar(); });
        nota.textContent = `${dados.length} de 27 estados com compras no recorte. Fonte das malhas: IBGE.`;
      } else {
        const [geo, nomes, dados] = await Promise.all([
          buscarJson(`${MALHAS}/estados/${UF_IBGE[uf]}?intrarregiao=municipio&${GEO}`),
          buscarJson(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`),
          api(`/dashboard/mapa/estados/${uf}/municipios`, { params: filtros }),
        ]);
        // O CSV do BPS não traz código IBGE: casa pelo nome normalizado quando co_ibge está vazio.
        const codigoPorNome = new Map(nomes.map((n) => [normalizar(n.nome), String(n.id)]));
        const nomePorCodigo = new Map(nomes.map((n) => [String(n.id), n.nome]));
        const porCodigo = new Map();
        const semCorrespondencia = [];
        for (const d of dados) {
          const cod = d.co_ibge ? String(d.co_ibge) : codigoPorNome.get(normalizar(d.no_municipio));
          if (cod) porCodigo.set(cod, d); else semCorrespondencia.push(d.no_municipio);
        }
        pintar(geo, (f) => porCodigo.get(f.properties.codarea),
          (f, d) => ({ nome: nomePorCodigo.get(f.properties.codarea) ?? d?.no_municipio ?? f.properties.codarea, d }),
          (f) => {
            const d = porCodigo.get(f.properties.codarea);
            if (!d) return;
            estado.municipio = { id: d.id_municipio, nome: nomePorCodigo.get(f.properties.codarea) ?? d.no_municipio };
            trilha();
            painel();
          });
        nota.textContent = `${dados.length} município(s) com compras.` +
          (semCorrespondencia.length ? ` Sem correspondência no mapa (nome diferente do IBGE): ${semCorrespondencia.join(', ')}.` : '');
      }
    } catch (e) {
      nota.textContent = `Não foi possível carregar o mapa: ${e.message}`;
    }

    function pintar(geo, dadoDe, rotuloDe, aoClicar) {
      const valores = geo.features.map((f) => dadoDe(f)?.[metrica] ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
      const cortes = quantis(valores, COR.sequencial.length);
      const cor = (v) => {
        if (!v) return COR.semDado;
        const i = cortes.findIndex((c) => v <= c);
        return corClasse(i === -1 ? cortes.length - 1 : i, cortes.length);
      };
      const estilo = (f) => ({ fillColor: cor(dadoDe(f)?.[metrica]), fillOpacity: 1, color: '#fcfcfb', weight: uf ? 0.6 : 1.2 });

      camada?.remove();
      camada = L.geoJSON(geo, {
        style: estilo,
        onEachFeature: (f, layer) => {
          const { nome, d } = rotuloDe(f, dadoDe(f));
          layer.bindTooltip(dica(nome, d), { sticky: true, className: 'dica-mapa' });
          layer.on({
            mouseover: () => layer.setStyle({ weight: 2.5, color: '#0b0b0b' }),
            mouseout: () => camada.resetStyle(layer),
            click: () => aoClicar(f),
          });
        },
      }).addTo(mapa);
      mapa.fitBounds(camada.getBounds(), { padding: [8, 8] });
      desenharLegenda(cortes, valores.length > 0);
    }
  }

  function dica(nome, d) {
    if (!d) return `<strong>${esc(nome)}</strong><br><span class="muted">Sem compras no recorte</span>`;
    return `<strong>${esc(nome)}</strong><br>
      Valor: ${fmt.moeda(d.vl_total)}<br>
      Itens: ${fmt.int(d.qt_itens)} · Processos: ${fmt.int(d.qt_processos)}<br>
      Instituições: ${fmt.int(d.qt_instituicoes)}`;
  }

  function desenharLegenda(cortes, temDados) {
    legenda?.remove();
    legenda = L.control({ position: 'bottomleft' });
    legenda.onAdd = () => {
      const div = L.DomUtil.create('div', 'legenda');
      const m = METRICAS[estado.metrica];
      let html = `<strong>${m.rotulo}</strong><br>`;
      if (temDados) {
        let anterior = 0;
        cortes.forEach((c, i) => {
          html += `<i style="background:${corClasse(i, cortes.length)}"></i>${m.fmt(anterior)} – ${m.fmt(c)}<br>`;
          anterior = c;
        });
      }
      html += `<i style="background:${COR.semDado};border:1px solid #c3c2b7"></i>Sem compras`;
      div.innerHTML = html;
      return div;
    };
    legenda.addTo(mapa);
  }

  function trilha() {
    const el = raiz.querySelector('#trilha');
    const partes = [`<button class="btn-link" data-ir="br">Brasil</button>`];
    if (estado.uf) partes.push(`<button class="btn-link" data-ir="uf">${estado.uf}</button>`);
    if (estado.municipio) partes.push(esc(estado.municipio.nome));
    el.innerHTML = partes.join(' › ');
    el.onclick = (ev) => {
      const ir = ev.target.dataset.ir;
      if (ir === 'br') { estado.uf = null; estado.municipio = null; desenhar(); }
      if (ir === 'uf') { estado.municipio = null; trilha(); painel(); }
    };
  }

  async function painel() {
    const el = raiz.querySelector('#painel');
    const params = { ...estado.filtros, uf: estado.uf ?? '', id_municipio: estado.municipio?.id ?? '' };
    const titulo = estado.municipio?.nome ?? estado.uf ?? 'Brasil';
    el.innerHTML = '<div class="cartao carregando">Carregando…</div>';
    try {
      const r = await api('/dashboard/mapa/resumo', { params });
      const k = r.kpi;
      const maxMed = Math.max(...r.medicamentos.map((m) => m.vl_total), 1);
      const maxInst = Math.max(...r.instituicoes.map((m) => m.vl_total), 1);
      el.innerHTML = `
        <div class="cartao" style="margin-bottom:12px">
          <h3>${esc(titulo)}</h3>
          ${kpis([
            ['Valor comprado', fmt.moedaCurta(k.vl_total)],
            ['Itens', fmt.int(k.qt_itens)],
            ['Processos', fmt.int(k.qt_processos)],
            ['Instituições', fmt.int(k.qt_instituicoes)],
            ['Medicamentos', fmt.int(k.qt_medicamentos)],
            ['Fornecedores', fmt.int(k.qt_fornecedores)],
          ])}
        </div>
        <div class="cartao" style="margin-bottom:12px">
          <h3>Medicamentos com maior gasto</h3>
          <ul class="lista-ranking">${r.medicamentos.map((m) => `
            <li><a class="nome" href="#/precos?catmat=${m.co_catmat}" title="${esc(m.ds_item)}">${esc(truncar(m.ds_item, 48))}</a>
              <span class="num">${fmt.moedaCurta(m.vl_total)}</span>
              <div class="barra"><span style="width:${(m.vl_total / maxMed) * 100}%"></span></div></li>`).join('') || '<li class="muted">Sem dados</li>'}</ul>
          <p class="nota">Clique em um medicamento para ver o preço de referência.</p>
        </div>
        <div class="cartao">
          <h3>Instituições que mais compraram</h3>
          <ul class="lista-ranking">${r.instituicoes.map((m) => `
            <li><span class="nome" title="${esc(m.no_instituicao)}">${esc(truncar(m.no_instituicao, 40))} <span class="muted">${esc(m.no_municipio)}/${esc(m.sg_uf)}</span></span>
              <span class="num">${fmt.moedaCurta(m.vl_total)}</span>
              <div class="barra"><span style="width:${(m.vl_total / maxInst) * 100}%"></span></div></li>`).join('') || '<li class="muted">Sem dados</li>'}</ul>
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="cartao erro">${esc(e.message)}</div>`;
    }
  }

  desenhar();
}

/** Com poucas classes (valores repetidos), espalha as cores pela rampa inteira em vez de usar só as mais claras. */
function corClasse(i, total) {
  const k = COR.sequencial.length;
  return COR.sequencial[total <= 1 ? k - 1 : Math.round((i * (k - 1)) / (total - 1))];
}

/** Limites superiores de k classes por quantil (classes com o mesmo número de áreas). */
function quantis(valores, k) {
  if (!valores.length) return [];
  const cortes = [];
  for (let i = 1; i <= k; i++) {
    const v = valores[Math.min(valores.length - 1, Math.ceil((i / k) * valores.length) - 1)];
    if (!cortes.length || v > cortes[cortes.length - 1]) cortes.push(v);
  }
  return cortes;
}
