import { createReadStream } from 'fs';

/**
 * Leitor de CSV em streaming (RFC 4180): aspas, aspas duplicadas ("") e quebras de linha
 * dentro de campos entre aspas. Lê o arquivo aos pedaços, então a memória não cresce
 * com o tamanho do arquivo. Cada linha é devolvida como array de strings ('' = vazio).
 */
export async function* lerCsv(
  caminho: string,
  opts: { separador?: string; encoding?: BufferEncoding } = {},
): AsyncGenerator<{ campos: string[]; linha: number }> {
  const sep = opts.separador ?? ';';
  const stream = createReadStream(caminho, { encoding: opts.encoding ?? 'utf8', highWaterMark: 1 << 20 });

  let campo = '';
  let campos: string[] = [];
  let entreAspas = false;
  let aspaPendente = false; // vimos uma aspa dentro de campo entre aspas: fecha ou é "" escapada?
  let linha = 1;
  let inicioRegistro = 1;
  let primeiroPedaco = true;

  for await (const pedaco of stream as AsyncIterable<string>) {
    let s = pedaco;
    if (primeiroPedaco) {
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
      primeiroPedaco = false;
    }
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (aspaPendente) {
        aspaPendente = false;
        if (ch === '"') { campo += '"'; continue; } // "" = aspa literal
        entreAspas = false; // a aspa anterior fechou o campo; trata ch normalmente abaixo
      }

      if (entreAspas) {
        if (ch === '"') aspaPendente = true;
        else {
          if (ch === '\n') linha++;
          campo += ch;
        }
        continue;
      }

      if (ch === '"') entreAspas = true;
      else if (ch === sep) { campos.push(campo); campo = ''; }
      else if (ch === '\n') {
        campos.push(campo.endsWith('\r') ? campo.slice(0, -1) : campo);
        yield { campos, linha: inicioRegistro };
        campos = []; campo = ''; linha++; inicioRegistro = linha;
      } else campo += ch;
    }
  }
  if (aspaPendente) entreAspas = false;
  if (campo !== '' || campos.length > 0) {
    campos.push(campo.endsWith('\r') ? campo.slice(0, -1) : campo);
    yield { campos, linha: inicioRegistro };
  }
}
