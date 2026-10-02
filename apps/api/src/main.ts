import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { readApiBindHost, readApiConfig } from './app/config';
import { configureApi } from './app/configure-api';

async function bootstrap() {
  const config = readApiConfig();
  const app = await NestFactory.create(AppModule);
  configureApi(app, config);
  await app.listen(config.port, readApiBindHost());
  Logger.log(`API is running on ${await app.getUrl()}/api`);
}

void bootstrap();
