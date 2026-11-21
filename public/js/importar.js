// Upload do CSV anual do BPS.
import { $, api, esc, fmt, tabela } from './util.js';

const ROTULOS = { municipio: 'Municípios', instituicao: 'Instituições', fornecedor: 'Fornecedores', fabricante: 'Fabricantes',
  pdm: 'PDM', medicamento: 'Medicamentos', processo_compra: 'Processos', item_compra: 'Itens' };

export function telaImportar(raiz) {
  raiz.innerHTML = `
    <h2>Importar CSV do BPS</h2>
    <div class="cartao" style="max-width:720px">
      <p class="secundario">Arquivo anual do Banco de Preços em Saúde, separado por ponto e vírgula. Reimportar o mesmo arquivo
        não duplica nada: cada item é identificado pelo <code>co_seq_bps</code> e atualizado.</p>
      <form id="form-imp" class="filtros">
        <input type="file" name="arquivo" accept=".csv,text/csv" required>
        <button class="btn primario" type="submit">Importar</button>
      </form>
      <p class="nota">Para arquivos muito grandes, use a linha de comando: <code>npm run importar -- arquivo.csv</code></p>
      <div id="relatorio"></div>
    </div>`;

  $('#form-imp', raiz).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = ev.target.querySelector('button');
    const el = $('#relatorio', raiz);
    botao.disabled = true;
    el.innerHTML = '<p class="carregando">Importando… pode levar alguns minutos.</p>';
    try {
      const r = await api('/importacao', { metodo: 'POST', corpo: new FormData(ev.target) });
      el.innerHTML = `
        <h3>Importação concluída em ${String(r.segundos).replace('.', ',')} s</h3>
        <p>${fmt.int(r.linhas)} linhas lidas · <strong>${fmt.int(r.inseridos)}</strong> itens novos ·
          ${fmt.int(r.existentes)} já existiam (atualizados) · ${fmt.int(r.ignorados)} ignorados</p>
        ${tabela([
          { titulo: 'Tabela', valor: (l) => esc(ROTULOS[l[0]] ?? l[0]) },
          { titulo: 'Registros novos', valor: (l) => fmt.int(l[1]), num: true },
        ], Object.entries(r.novos))}
        ${r.erros.length ? `<h3 style="margin-top:16px">Linhas ignoradas</h3>${tabela([
          { titulo: 'Linha', valor: (l) => l.linha, num: true },
          { titulo: 'Motivo', valor: (l) => esc(l.mensagem) },
        ], r.erros)}` : ''}`;
    } catch (e) {
      el.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    } finally {
      botao.disabled = false;
    }
  });
}
