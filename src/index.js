// ============================================
// BotFlow.ai — Servidor Principal
// ============================================

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';

import { config } from './config.js';
import pool, { testConnection } from './db/index.js';
import { AppError } from './services/auth.service.js';

// Rutas
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import organizationRoutes from './routes/organization.routes.js';
import botRoutes from './routes/bot.routes.js';
import gatewayRoutes from './routes/gateway.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import embeddingRoutes from './routes/embedding.routes.js';

// ============================================
// Crear instancia de Fastify
// ============================================

const fastify = Fastify({
  logger: {
    level: config.server.env === 'production' ? 'info' : 'debug',
    transport: config.server.env === 'development' ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    } : undefined,
  },
  trustProxy: true,
});

// ============================================
// Plugins globales
// ============================================

// CORS — permite frontend + widget desde cualquier origen
await fastify.register(cors, {
  origin: (origin, cb) => {
    // Permitir requests sin origin (mobile apps, curl, etc.)
    if (!origin) return cb(null, true);
    // Permitir el frontend configurado
    if (origin === config.cors.origin) return cb(null, true);
    // Permitir cualquier origin para las rutas del gateway (widget embebido)
    // Las rutas autenticadas están protegidas por JWT, no por CORS
    return cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

// JWT
await fastify.register(jwt, {
  secret: config.jwt.secret,
  sign: { expiresIn: config.jwt.expiresIn },
});

// Rate limiting
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
});

// Cookies
await fastify.register(cookie);

// ============================================
// Decoradores
// ============================================

// Hacer el pool de DB accesible desde los handlers
fastify.decorate('db', { query: (...args) => pool.query(...args) });

// ============================================
// Error handler global
// ============================================

fastify.setErrorHandler((error, request, reply) => {
  // Errores operacionales (los nuestros)
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    });
  }

  // Errores de rate limit
  if (error.statusCode === 429) {
    return reply.code(429).send({
      error: 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.',
      statusCode: 429,
    });
  }

  // Errores de validación de Fastify
  if (error.validation) {
    return reply.code(400).send({
      error: 'Datos inválidos',
      details: error.validation,
      statusCode: 400,
    });
  }

  // Errores inesperados
  fastify.log.error(error);
  return reply.code(500).send({
    error: config.server.env === 'production'
      ? 'Error interno del servidor'
      : error.message,
    statusCode: 500,
  });
});

// ============================================
// Registrar rutas
// ============================================

await fastify.register(healthRoutes, { prefix: '/api' });
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(organizationRoutes, { prefix: '/api/organizations' });
await fastify.register(botRoutes, { prefix: '/api/bots' });
await fastify.register(analyticsRoutes, { prefix: '/api/bots' });
await fastify.register(gatewayRoutes, { prefix: '/api/gateway' });
await fastify.register(embeddingRoutes, { prefix: '/api/bots' });

// ============================================
// Iniciar servidor
// ============================================

async function start() {
  try {
    // Verificar conexión a DB
    const dbOk = await testConnection();
    if (!dbOk) {
      fastify.log.warn('⚠️  No se pudo conectar a PostgreSQL. Algunas funciones no estarán disponibles.');
    }

    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    console.log(`
╔══════════════════════════════════════════╗
║           🤖 BotFlow.ai API             ║
║──────────────────────────────────────────║
║  Server:  http://localhost:${config.server.port}          ║
║  Env:     ${config.server.env.padEnd(28)}  ║
║  DB:      ${dbOk ? '✅ Connected' : '❌ Disconnected'}${' '.repeat(17)}║
╚══════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`${signal} recibido. Cerrando servidor...`);
    await fastify.close();
    await pool.end();
    process.exit(0);
  });
});
