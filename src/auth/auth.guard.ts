import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Perfil, UsuarioToken, validarToken } from './token';

const PUBLICO = 'publico';
const PERFIS = 'perfis';

/** Rota sem login (só o próprio login). */
export const Publico = () => SetMetadata(PUBLICO, true);

/** Restringe a rota a esses perfis. Sem o decorator, qualquer usuário logado acessa. */
export const Perfis = (...perfis: Perfil[]) => SetMetadata(PERFIS, perfis);

/** Injeta o usuário do token no parâmetro do controller. */
export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioToken => ctx.switchToHttp().getRequest<Request & { usuario: UsuarioToken }>().usuario,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const alvos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, alvos)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { usuario?: UsuarioToken }>();
    const header = req.headers.authorization ?? '';
    const usuario = header.startsWith('Bearer ') ? validarToken(header.slice(7)) : null;
    if (!usuario) throw new UnauthorizedException('Faça login novamente.');
    req.usuario = usuario;

    const perfis = this.reflector.getAllAndOverride<Perfil[] | undefined>(PERFIS, alvos);
    if (perfis && !perfis.includes(usuario.perfil)) {
      throw new ForbiddenException('Seu perfil não permite esta operação.');
    }
    return true;
  }
}
