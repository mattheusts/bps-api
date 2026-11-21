import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { UsuarioAtual } from '../auth/auth.guard';
import { UsuarioToken } from '../auth/token';
import { CrudService, ParamsLista } from './crud.service';

// As permissões por tabela (leitura/escrita) são checadas no service,
// porque a rota é a mesma para todas as tabelas.
@Controller('crud')
export class CrudController {
  constructor(private readonly crud: CrudService) {}

  @Get()
  meta(@UsuarioAtual() u: UsuarioToken) {
    return this.crud.meta(u);
  }

  @Get(':tabela')
  listar(@Param('tabela') tabela: string, @Query() q: ParamsLista, @UsuarioAtual() u: UsuarioToken) {
    return this.crud.listar(tabela, q, u);
  }

  @Get(':tabela/opcoes')
  opcoes(@Param('tabela') tabela: string, @Query('q') q: string, @UsuarioAtual() u: UsuarioToken) {
    return this.crud.opcoes(tabela, q, u);
  }

  @Get(':tabela/:id')
  obter(@Param('tabela') tabela: string, @Param('id') id: string, @UsuarioAtual() u: UsuarioToken) {
    return this.crud.obter(tabela, id, u);
  }

  @Post(':tabela')
  criar(@Param('tabela') tabela: string, @Body() body: Record<string, unknown>, @UsuarioAtual() u: UsuarioToken) {
    return this.crud.criar(tabela, body, u);
  }

  @Put(':tabela/:id')
  atualizar(
    @Param('tabela') tabela: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UsuarioAtual() u: UsuarioToken,
  ) {
    return this.crud.atualizar(tabela, id, body, u);
  }

  @Delete(':tabela/:id')
  @HttpCode(204)
  excluir(@Param('tabela') tabela: string, @Param('id') id: string, @UsuarioAtual() u: UsuarioToken) {
    return this.crud.excluir(tabela, id, u);
  }
}
