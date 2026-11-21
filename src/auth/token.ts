import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

export type Perfil = 'ADMIN' | 'OPERADOR' | 'CONSULTA';

export interface UsuarioToken {
  id: number;
  nome: string;
  perfil: Perfil;
}

interface Payload extends UsuarioToken {
  exp: number; // segundos desde 1970
}

// Token no formato JWT (HS256) implementado com crypto do Node,
// para não depender de @nestjs/jwt. Qualquer biblioteca JWT consegue validá-lo.
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function assinar(dados: string): string {
  return createHmac('sha256', config.appSecret).update(dados).digest('base64url');
}

export function gerarToken(u: UsuarioToken): string {
  const payload: Payload = { ...u, exp: Math.floor(Date.now() / 1000) + config.tokenHoras * 3600 };
  const corpo = `${HEADER}.${b64(JSON.stringify(payload))}`;
  return `${corpo}.${assinar(corpo)}`;
}

export function validarToken(token: string): UsuarioToken | null {
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== HEADER) return null;
  const esperado = Buffer.from(assinar(`${partes[0]}.${partes[1]}`));
  const recebido = Buffer.from(partes[2]);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  try {
    const p = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as Payload;
    if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return { id: p.id, nome: p.nome, perfil: p.perfil };
  } catch {
    return null;
  }
}
