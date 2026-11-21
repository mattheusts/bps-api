/**
 * Importa um CSV do BPS pela linha de comando (melhor para arquivos grandes que pelo navegador).
 * Uso: npm run importar -- caminho/2026.csv [email-do-usuario]
 * Sem e-mail, os registros ficam em nome do primeiro ADMIN cadastrado.
 */
import { DatabaseService } from '../database/database.service';
import { ImportacaoService } from '../importacao/importacao.service';

async function main() {
  const [caminho, email] = process.argv.slice(2);
  if (!caminho) {
    console.error('Uso: npm run importar -- <arquivo.csv> [email]');
    process.exit(1);
  }
  const db = new DatabaseService();
  try {
    const u = email
      ? await db.one<{ id_usuario: number }>('SELECT id_usuario FROM usuario WHERE ds_email = ?', [email.toLowerCase()])
      : await db.one<{ id_usuario: number }>("SELECT id_usuario FROM usuario WHERE tp_perfil = 'ADMIN' ORDER BY id_usuario LIMIT 1");
    if (!u) throw new Error('Usuário não encontrado. Crie um com: npm run criar-admin');

    const rel = await new ImportacaoService(db).importar(caminho, u.id_usuario);
    console.log(JSON.stringify(rel, null, 2));
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((e) => {
  console.error(e.response?.message ?? e.sqlMessage ?? e.message);
  process.exit(1);
});
