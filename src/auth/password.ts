import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// scrypt vem no Node, sem dependência externa (bcrypt exigiria compilação nativa).
// Formato guardado em usuario.ds_senha_hash: scrypt$<salt hex>$<hash hex> (168 caracteres)
const KEYLEN = 64;

export function hashSenha(senha: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [alg, saltHex, hashHex] = guardado.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}
