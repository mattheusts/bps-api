import { Controller, Get } from '@nestjs/common';
import { Publico } from './auth/auth.guard';

@Controller('health')
export class HealthController {
  /** Não consulta o banco: o primeiro deploy precisa subir antes de o esquema ser criado. */
  @Publico()
  @Get()
  verificar() {
    return { status: 'ok' };
  }
}
