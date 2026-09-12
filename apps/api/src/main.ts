import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SolArchExceptionFilter } from './common/filters/http-exception.filter';
import { EnvService } from './config/env.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const env = app.get(EnvService);

  // Security & Middlewares
  app.use(helmet());
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global pipes & filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new SolArchExceptionFilter());

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('SolArch Marketplace API')
    .setDescription('Authoritative backend API for SolArch marketplace, Solana USDC payments, and DRM licensing')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.port);
  logger.log(`SolArch API server listening on http://localhost:${env.port}`);
  logger.log(`Swagger documentation available at http://localhost:${env.port}/docs`);
}

bootstrap();
