import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { EnvService } from './env.service';

export function corsOptions(env: EnvService): CorsOptions {
  const allowed = new Set(env.webAllowedOrigins);
  return {
    origin: (origin, callback) => callback(null, origin === undefined || allowed.has(origin)),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  };
}
