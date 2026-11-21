import { $, api, esc, sessao } from './util.js';
import { telaCrud } from './crud.js';
import { telaImportar } from './importar.js';
import { telaMapa } from './mapa.js';
import { telaMercado } from './mercado.js';
import { telaPrecos } from './precos.js';
import { telaSobrepreco } from './sobrepreco.js';

let meta = [];

const rotas = {
  mapa: () => telaMapa($('#conteudo')),
  precos: (p) => telaPrecos($('#conteudo'), p),
  sobrepreco: (p) => telaSobrepreco($('#conteudo'), p),
  mercado: (p) => telaMercado($('#conteudo'), p),
  importar: () => telaImportar($('#conteudo')),
  crud: (p, tabela) => {
    const t = meta.find((m) => m.nome === tabela);
    if (!t) { $('#conteudo').innerHTML = '<p>Cadastro não encontrado ou sem permissão.</p>'; return; }
    telaCrud($('#conteudo'), t, meta);
  },
};

/** Rotas no formato #/tela/arg?param=valor */
function navegar() {
  const [caminho, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [tela, arg] = caminho.split('/');
  const params = Object.fromEntries(new URLSearchParams(query ?? ''));
  const rota = rotas[tela] ? tela : 'mapa';
  document.querySelectorAll('.menu a').forEach((a) => {
    a.classList.toggle('ativo', a.getAttribute('href') === `#/${caminho}` || (rota === 'mapa' && a.getAttribute('href') === '#/mapa' && !rotas[tela]));
  });
  Promise.resolve(rotas[rota](params, arg)).catch((e) => {
    $('#conteudo').innerHTML = `<p class="erro">${esc(e.message)}</p>`;
  });
}

async function iniciar() {
  sessao.usuario = await api('/auth/me');
  meta = await api('/crud');
  $('#menu-cadastros').innerHTML = meta.map((t) => `<a href="#/crud/${t.nome}">${esc(t.rotulo)}</a>`).join('');
  if (['ADMIN', 'OPERADOR'].includes(sessao.usuario.perfil)) {
    $('#menu-importar').innerHTML = '<div class="menu-grupo">Dados</div><a href="#/importar">Importar CSV do BPS</a>';
  }
  $('#usuario-nome').innerHTML = `${esc(sessao.usuario.nome)}<br><span class="muted">${esc(sessao.usuario.perfil)}</span>`;
  $('#login').hidden = true;
  $('#app').hidden = false;
  window.addEventListener('hashchange', navegar);
  navegar();
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    const r = await api('/auth/login', { metodo: 'POST', corpo: { email: f.get('email'), senha: f.get('senha') } });
    sessao.token = r.token;
    await iniciar();
  } catch (e) {
    $('#login-erro').textContent = e.message;
    $('#login-erro').hidden = false;
  }
});

$('#sair').addEventListener('click', () => {
  sessao.token = null;
  location.hash = '';
  location.reload();
});

if (sessao.token) iniciar().catch(() => { sessao.token = null; $('#login').hidden = false; });
else $('#login').hidden = false;
