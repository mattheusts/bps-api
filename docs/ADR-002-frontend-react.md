# ADR-002: Frontend em React separado da API

**Status:** Aceito
**Data:** 2026-11-21
**Substitui:** a parte de frontend do ADR-001

## Contexto

O ADR-001 serviu a interface como HTML e JS puro dentro da API e descartou React porque o framework não acrescentava nada ao que a disciplina avalia. Depois disso, passou a ser requisito ter uma interface moderna em Vite, React e shadcn/ui.

## Decisão

A interface passa a ser o projeto `bps-web`, em repositório próprio. A API deixa de servir arquivos estáticos e expõe apenas as rotas em `/api`. O SQL, as regras de negócio e os contratos da API não mudam.

Em desenvolvimento e no `vite preview`, o Vite encaminha `/api` para a API. Por isso, a API não precisa habilitar CORS.

## Consequências

- **Fica mais fácil:** evoluir a interface sem tocar na API e reutilizar componentes entre as telas.
- **Fica mais difícil:** rodar o sistema, porque agora são dois processos e o frontend tem etapa de build.
- **Permissões:** a interface esconde ações conforme o perfil, mas quem garante a regra continua sendo a API.
- **Publicação:** um ambiente de produção precisa servir o build do `bps-web` e encaminhar `/api` para a API no mesmo domínio, ou habilitar CORS.
- **Mapas:** continuam dependendo da API do IBGE no navegador.
- **Histórico:** o frontend anterior continua disponível no primeiro commit do repositório.
