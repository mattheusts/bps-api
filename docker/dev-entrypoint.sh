#!/bin/sh
set -eu

# node_modules fica em um volume: reinstala só quando o lockfile muda.
hash_atual=$(sha256sum package-lock.json | cut -d' ' -f1)
hash_instalado=$(cat node_modules/.lock-hash 2>/dev/null || true)
if [ "$hash_atual" != "$hash_instalado" ]; then
  echo "[dev] package-lock.json mudou. Instalando dependências..."
  npm ci --no-audit --no-fund
  echo "$hash_atual" > node_modules/.lock-hash
fi

# O tsc gera os arquivos mesmo com erro de tipo, então a API continua subindo.
npx tsc -p tsconfig.build.json || echo "[dev] Build inicial com erros de tipo."
npx tsc -p tsconfig.build.json --watch --preserveWatchOutput &

exec node --watch dist/main.js
