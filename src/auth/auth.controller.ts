import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Publico, UsuarioAtual } from './auth.guard';
import { conferirSenha } from './password';
import { Perfil, UsuarioToken, gerarToken } from './token';

interface LinhaUsuario {
  id_usuario: number;
  no_usuario: string;
  ds_senha_hash: string;
  tp_perfil: Perfil;
  fg_ativo: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly db: DatabaseService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; senha?: string }) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const senha = String(body?.senha ?? '');
    const u = await this.db.one<LinhaUsuario>(
      `SELECT id_usuario, no_usuario, ds_senha_hash, tp_perfil, fg_ativo
         FROM usuario
        WHERE ds_email = ?`,
      [email],
    );
    // A mesma mensagem para e-mail inexistente e senha errada: não revela quais e-mails existem.
    if (!u || !conferirSenha(senha, u.ds_senha_hash)) throw new UnauthorizedException('E-mail ou senha inválidos.');
    if (u.fg_ativo !== 'S') throw new UnauthorizedException('Usuário inativo.');

    const usuario: UsuarioToken = { id: u.id_usuario, nome: u.no_usuario, perfil: u.tp_perfil };
    return { token: gerarToken(usuario), usuario };
  }

  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioToken) {
    return usuario;
  }
}
