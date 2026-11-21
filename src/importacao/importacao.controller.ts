import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { Perfis, UsuarioAtual } from '../auth/auth.guard';
import { UsuarioToken } from '../auth/token';
import { ImportacaoService } from './importacao.service';

@Controller('importacao')
export class ImportacaoController {
  constructor(private readonly importacao: ImportacaoService) {}

  /** Recebe o CSV (campo "arquivo") em disco, não em memória, e importa em streaming. */
  @Post()
  @Perfis('ADMIN', 'OPERADOR')
  @UseInterceptors(FileInterceptor('arquivo', { dest: tmpdir(), limits: { fileSize: 500 * 1024 * 1024 } }))
  async importar(@UploadedFile() arquivo: { path: string; originalname: string } | undefined, @UsuarioAtual() u: UsuarioToken) {
    if (!arquivo) throw new BadRequestException('Envie o arquivo CSV no campo "arquivo".');
    try {
      return await this.importacao.importar(arquivo.path, u.id);
    } finally {
      await unlink(arquivo.path).catch(() => undefined);
    }
  }
}
