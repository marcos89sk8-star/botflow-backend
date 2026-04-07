// ============================================
// BotFlow.ai — Rutas de Health Check
// ============================================

import { testConnection } from '../db/index.js';

export default async function healthRoutes(fastify) {
  // GET /api/health
  fastify.get('/health', async (request, reply) => {
    const dbOk = await testConnection().catch(() => false);

    const status = dbOk ? 'ok' : 'degraded';
    const code = dbOk ? 200 : 503;

    return reply.code(code).send({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'connected' : 'disconnected',
      },
      version: '1.0.0',
    });
  });

  // GET /api/ping
  fastify.get('/ping', async () => {
    return { pong: true, timestamp: Date.now() };
  });
}
