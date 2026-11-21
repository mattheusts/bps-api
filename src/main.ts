import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { MysqlErrorFilter } from './database/mysql-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new MysqlErrorFilter());
  await app.listen(config.port);
  Logger.log(`API em http://localhost:${config.port}/api`, 'Bootstrap');
}

bootstrap();
