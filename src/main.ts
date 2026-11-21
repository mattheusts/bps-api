import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { config } from './config';
import { MysqlErrorFilter } from './database/mysql-error.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new MysqlErrorFilter());
  // Frontend estático (HTML + JS puro) servido pelo próprio Nest, na raiz.
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(config.port);
  Logger.log(`Aplicação em http://localhost:${config.port}`, 'Bootstrap');
}

bootstrap();
