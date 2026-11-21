import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CrudModule } from './crud/crud.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { ImportacaoModule } from './importacao/importacao.module';

@Module({
  imports: [DatabaseModule, AuthModule, CrudModule, DashboardModule, ImportacaoModule],
  controllers: [HealthController],
})
export class AppModule {}
