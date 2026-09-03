import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Expo (exp://, http://localhost:8081) and Electron (file://) have no stable origin — allow all in dev.
  app.enableCors({ origin: true, credentials: true });
  await app.listen(process.env.PORT ?? 3333);
}

void bootstrap();
