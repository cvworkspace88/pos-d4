import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppRouterHost } from 'nestjs-trpc';
import { AppModule } from './app.module';
import { parseDeployment } from './deployment-rules';

async function bootstrap() {
  // ConfigModule.forRoot (evaluated by AppModule's import) loads `.env` into process.env.
  await ConfigModule.envVariablesLoaded;
  const deployment = parseDeployment(process.env.DEPLOYMENT);
  if (deployment === 'all') {
    throw new Error('DEPLOYMENT=all is for contract generation only; run the server as cloud or local.');
  }

  const app = await NestFactory.create(AppModule.register(deployment));
  // Expo (exp://, http://localhost:8081) and Electron (file://) have no stable origin — allow all in dev.
  app.enableCors({ origin: true, credentials: true });
  await app.listen(process.env.PORT ?? 3333);

  const routers = Object.keys(app.get(AppRouterHost).appRouter._def.record).sort();
  new Logger('Deployment').log(`${deployment}: ${routers.join(', ')}`);
}

void bootstrap();
