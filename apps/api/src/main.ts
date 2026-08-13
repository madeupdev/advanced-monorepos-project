import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { configureApi } from './app/configure-api';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApi(app);
  const port = Number(process.env.API_PORT ?? 3333);
  await app.listen(port, '127.0.0.1');
  Logger.log(`API is running on ${await app.getUrl()}/api`);
}

void bootstrap();
