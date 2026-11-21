// Tela de CRUD genérica: lista, busca, ordenação, paginação e formulário montados a partir dos metadados da API.
import { $, api, aviso, esc, fmt } from './util.js';

export function telaCrud(conteudo, t, meta) {
  // Contêiner próprio: os listeners morrem junto com a tela ao navegar para outra.
  conteudo.innerHTML = '';
  const raiz = document.createElement('div');
  conteudo.appendChild(raiz);
  const estado = { q: '', pagina: 1, ordem: '', dir: 'asc' };
  const visiveis = t.colunas.filter((c) => !c.ocultaNaLista && c.tipo !== 'senha');

  raiz.innerHTML = `
    <div class="cabecalho"><h2>${esc(t.rotulo)}</h2>
      ${t.podeEscrever ? '<button class="btn primario" id="novo">Novo</button>' : '<span class="muted">Somente leitura</span>'}</div>
    <div class="filtros"><label style="min-width:320px">Buscar<input id="q" type="search" placeholder="texto ou código"></label></div>
    <div class="cartao"><div id="lista" class="carregando">Carregando…</div>
      <div class="paginacao" id="paginacao"></div></div>`;

  let timer;
  $('#q', raiz).addEventListener('input', (ev) => {
    clearTimeout(timer);
    timer = setTimeout(() => { estado.q = ev.target.value; estado.pagina = 1; carregar(); }, 300);
  });
  $('#novo', raiz)?.addEventListener('click', () => formulario(null));

  async function carregar() {
    const r = await api(`/crud/${t.nome}`, { params: { q: estado.q, pagina: estado.pagina, ordem: estado.ordem, dir: estado.dir } });
    const cab = visiveis.map((c) => {
      const seta = estado.ordem === c.nome ? (estado.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="ordenavel ${['int', 'decimal'].includes(c.tipo) && !c.fk ? 'num' : ''}" data-col="${c.nome}">${esc(c.rotulo)}${seta}</th>`;
    }).join('');
    const linhas = r.linhas.map((l) => `<tr>${visiveis.map((c) => celula(c, l)).join('')}
      ${t.podeEscrever ? `<td><div class="acoes"><button class="btn-link" data-editar="${l[t.pk]}">Editar</button>
        <button class="btn-link erro" data-excluir="${l[t.pk]}">Excluir</button></div></td>` : ''}</tr>`).join('');
    $('#lista', raiz).className = 'tabela-wrap';
    $('#lista', raiz).innerHTML = r.linhas.length
      ? `<table><thead><tr>${cab}${t.podeEscrever ? '<th></th>' : ''}</tr></thead><tbody>${linhas}</tbody></table>`
      : '<p class="muted">Nenhum registro.</p>';

    const paginas = Math.max(1, Math.ceil(r.total / r.tamanho));
    $('#paginacao', raiz).innerHTML = `<span class="muted">${fmt.int(r.total)} registro(s)</span>
      <button class="btn" data-pag="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>‹</button>
      <span>${r.pagina} / ${paginas}</span>
      <button class="btn" data-pag="${r.pagina + 1}" ${r.pagina >= paginas ? 'disabled' : ''}>›</button>`;
  }

  raiz.addEventListener('click', async (ev) => {
    const alvo = ev.target.closest('[data-col],[data-pag],[data-editar],[data-excluir]');
    if (!alvo || !raiz.contains(alvo)) return;
    if (alvo.dataset.col) {
      estado.dir = estado.ordem === alvo.dataset.col && estado.dir === 'asc' ? 'desc' : 'asc';
      estado.ordem = alvo.dataset.col;
      carregar();
    } else if (alvo.dataset.pag) {
      estado.pagina = Number(alvo.dataset.pag);
      carregar();
    } else if (alvo.dataset.editar) {
      formulario(await api(`/crud/${t.nome}/${alvo.dataset.editar}`));
    } else if (alvo.dataset.excluir) {
      if (!confirmarExclusao()) return;
      try {
        await api(`/crud/${t.nome}/${alvo.dataset.excluir}`, { metodo: 'DELETE' });
        aviso('Registro excluído.');
        carregar();
      } catch (e) { aviso(e.message, true); }
    }
  });

  // confirm() bloqueia a página; é aceitável aqui porque só ocorre por clique explícito em "Excluir".
  function confirmarExclusao() { return window.confirm('Excluir este registro?'); }

  function formulario(registro) {
    const editando = registro !== null;
    const campos = t.colunas.filter((c) => !c.auto);
    const modal = $('#modal');
    modal.innerHTML = `<form class="modal-card" id="form-crud">
      <h3>${editando ? 'Editar' : 'Novo'} · ${esc(t.rotulo)}</h3>
      <div class="form-grade">${campos.map((c) => campo(c, registro)).join('')}</div>
      <p class="erro" id="form-erro" hidden></p>
      <div class="form-acoes"><button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn primario">Salvar</button></div></form>`;
    modal.hidden = false;

    // Selects de chave estrangeira: busca no servidor conforme a pessoa digita.
    modal.querySelectorAll('[data-fk]').forEach((sel) => {
      const busca = modal.querySelector(`[data-busca="${sel.name}"]`);
      const preencher = async (q) => {
        const atual = sel.value;
        const atualTexto = sel.selectedOptions[0]?.textContent;
        const ops = await api(`/crud/${sel.dataset.fk}/opcoes`, { params: { q } });
        sel.innerHTML = `<option value="">${sel.required ? 'Selecione…' : '(nenhum)'}</option>` +
          ops.map((o) => `<option value="${o.id}">${esc(o.rotulo)}</option>`).join('');
        if (atual && !ops.some((o) => String(o.id) === atual)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(atual)}">${esc(atualTexto)}</option>`);
        sel.value = atual;
      };
      let tm;
      busca.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => preencher(busca.value), 300); });
      preencher('');
    });

    $('#cancelar', modal).onclick = () => { modal.hidden = true; };
    $('#form-crud', modal).onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(ev.target));
      try {
        if (editando) await api(`/crud/${t.nome}/${registro[t.pk]}`, { metodo: 'PUT', corpo: dados });
        else await api(`/crud/${t.nome}`, { metodo: 'POST', corpo: dados });
        modal.hidden = true;
        aviso('Registro salvo.');
        carregar();
      } catch (e) {
        $('#form-erro', modal).textContent = e.message;
        $('#form-erro', modal).hidden = false;
      }
    };
  }

  function campo(c, registro) {
    const v = registro?.[c.nome] ?? '';
    const req = c.obrigatorio ? 'required' : '';
    const rotulo = `${esc(c.rotulo)}${c.obrigatorio ? ' *' : ''}`;
    if (c.fk) {
      const atual = v !== '' ? `<option value="${esc(v)}" selected>${esc(registro[`${c.nome}__rotulo`] ?? v)}</option>` : '';
      const nomeRef = meta.find((m) => m.nome === c.fk)?.rotulo ?? c.fk;
      return `<label class="largo">${rotulo}
        <input type="search" data-busca="${c.nome}" placeholder="Buscar em ${esc(nomeRef)}…">
        <select name="${c.nome}" data-fk="${c.fk}" ${req}>${atual}</select></label>`;
    }
    switch (c.tipo) {
      case 'enum':
      case 'flag': {
        const ops = c.tipo === 'flag' ? [['S', 'Sim'], ['N', 'Não']] : c.opcoes.map((o) => [o, o]);
        return `<label>${rotulo}<select name="${c.nome}" ${req}><option value="">—</option>
          ${ops.map(([val, txt]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${txt}</option>`).join('')}</select></label>`;
      }
      case 'text':
        return `<label class="largo">${rotulo}<textarea name="${c.nome}" ${req}>${esc(v)}</textarea></label>`;
      case 'senha':
        return `<label>${rotulo}${registro ? '' : ' *'}<input type="password" name="${c.nome}" autocomplete="new-password"
          ${registro ? 'placeholder="em branco = manter a atual"' : 'required'} minlength="8"></label>`;
      case 'date':
        return `<label>${rotulo}<input type="date" name="${c.nome}" value="${esc(v)}" ${req}></label>`;
      case 'int':
        return `<label>${rotulo}<input type="number" step="1" name="${c.nome}" value="${esc(v)}" ${req}></label>`;
      case 'decimal':
        return `<label>${rotulo}<input type="number" step="any" name="${c.nome}" value="${esc(v)}" ${req}></label>`;
      default: {
        const largo = (c.tamanho ?? 0) > 60 ? 'largo' : '';
        const valor = c.cnpj ? fmt.cnpj(v) : v;
        return `<label class="${largo}">${rotulo}<input name="${c.nome}" value="${esc(valor)}" ${req}
          maxlength="${c.cnpj ? 18 : c.tamanho ?? ''}" ${c.cnpj ? 'placeholder="00.000.000/0000-00"' : ''}></label>`;
      }
    }
  }

  carregar().catch((e) => { $('#lista', raiz).innerHTML = `<p class="erro">${esc(e.message)}</p>`; });
}

function celula(c, l) {
  const v = l[c.nome];
  if (c.fk) return `<td>${esc(l[`${c.nome}__rotulo`] ?? v ?? '—')}</td>`;
  if (v === null || v === undefined) return '<td class="muted">—</td>';
  switch (c.tipo) {
    case 'decimal': return `<td class="num">${c.nome.startsWith('vl_preco_unit') ? fmt.preco(v) : fmt.num(v)}</td>`;
    case 'int': return `<td class="num">${['co_catmat', 'co_pdm', 'co_ibge', 'co_seq_bps', 'co_classe', 'ano_compra'].includes(c.nome) ? v : fmt.int(v)}</td>`;
    case 'date': return `<td>${fmt.data(v)}</td>`;
    case 'datetime': return `<td>${fmt.data(v)}</td>`;
    case 'flag': return `<td>${v === 'S' ? 'Sim' : 'Não'}</td>`;
    default: return `<td title="${esc(v)}">${esc(c.cnpj ? fmt.cnpj(v) : String(v).length > 70 ? `${String(v).slice(0, 69)}…` : v)}</td>`;
  }
}
