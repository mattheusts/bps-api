function env(nome: string, padrao?: string): string {
  const valor = process.env[nome] ?? padrao;
  if (valor === undefined) {
    throw new Error(`Variável de ambiente ${nome} não definida (veja .env.example)`);
  }
  return valor;
}

export const config = {
  port: Number(env('PORT', '3000')),
  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER', 'root'),
    password: env('DB_PASSWORD', ''),
    database: env('DB_NAME', 'bps'),
  },
  appSecret: env('APP_SECRET', ''),
  tokenHoras: Number(env('TOKEN_HORAS', '8')),
  logSql: env('LOG_SQL', '0') === '1',
};

if (!config.appSecret || config.appSecret === 'troque-isto') {
  // Sem segredo próprio, qualquer pessoa que leia o código consegue forjar um token.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Defina APP_SECRET com um valor próprio para rodar em produção.');
  }
  // eslint-disable-next-line no-console
  console.warn('[config] APP_SECRET não definido ou com valor de exemplo. Defina um valor próprio no .env.');
  if (!config.appSecret) config.appSecret = 'segredo-de-desenvolvimento';
}
