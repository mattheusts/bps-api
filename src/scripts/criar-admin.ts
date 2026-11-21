/**
 * Cria (ou redefine a senha de) um usuário ADMIN. Necessário para o primeiro login.
 * Uso: npm run criar-admin -- admin@exemplo.com minhasenha123 "Nome do Admin"
 */
import { createConnection } from 'mysql2/promise';
import { hashSenha } from '../auth/password';
import { config } from '../config';

async function main() {
  const [email, senha, nome = 'Administrador'] = process.argv.slice(2);
  if (!email || !senha) {
    console.error('Uso: npm run criar-admin -- <email> <senha> "<nome>"');
    process.exit(1);
  }
  if (senha.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }
  const conn = await createConnection(config.db);
  await conn.query(
    `INSERT INTO usuario (no_usuario, ds_email, ds_senha_hash, tp_perfil, fg_ativo)
     VALUES (?, ?, ?, 'ADMIN', 'S')
     ON DUPLICATE KEY UPDATE ds_senha_hash = VALUES(ds_senha_hash), tp_perfil = 'ADMIN', fg_ativo = 'S'`,
    [nome, email.trim().toLowerCase(), hashSenha(senha)],
  );
  await conn.end();
  console.log(`Admin ${email} pronto.`);
}

main().catch((e) => {
  console.error(e.sqlMessage ?? e.message);
  process.exit(1);
});
