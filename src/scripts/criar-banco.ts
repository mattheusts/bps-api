/**
 * Cria o banco e as tabelas rodando os arquivos de database/ em ordem.
 * Alternativa a: mysql -u root -p < database/01_schema.sql
 * ATENÇÃO: 01_schema.sql apaga e recria as tabelas.
 *
 * Uso: npm run db:criar
 */
import { readdirSync, readFileSync } from 'fs';
import { createConnection } from 'mysql2/promise';
import { join } from 'path';
import { config } from '../config';

async function main() {
  const { database: _ignorado, ...semBanco } = config.db; // o banco ainda pode não existir
  const conn = await createConnection({ ...semBanco, multipleStatements: true, charset: 'utf8mb4' });
  const pasta = join(__dirname, '..', '..', 'database');
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`Executando ${arquivo}... `);
    await conn.query(readFileSync(join(pasta, arquivo), 'utf8'));
    console.log('ok');
  }
  await conn.end();
  console.log('Banco pronto. Próximo passo: npm run criar-admin -- <email> <senha> "<nome>"');
}

main().catch((e) => {
  console.error(e.sqlMessage ?? e.message);
  process.exit(1);
});
