// ============================================
// BotFlow.ai — Rutas de Embeddings
// POST /api/bots/:id/embeddings/reprocess  → Re-generar embeddings
// GET  /api/bots/:id/embeddings/stats      → Stats de embeddings
// ============================================

import { authenticate } from '../middleware/auth.js';
import { requireOrganization, requireActivePlan } from '../middleware/auth.js';
import { reprocessBotEmbeddings, getEmbeddingStats } from '../services/embedding.service.js';
import { AppError } from '../services/auth.service.js';
import { query } from '../db/index.js';

export default async function embeddingRoutes(fastify) {
  fastify.addHook('preHandler', authenticate(fastify));
  fastify.addHook('preHandler', requireOrganization());
  fastify.addHook('preHandler', requireActivePlan());

  // POST /api/bots/:id/embeddings/reprocess
  fastify.post('/:id/embeddings/reprocess', async (request, reply) => {
    const botId = request.params.id;

    // Verificar ownership
    const bot = await query(
      'SELECT id FROM bots WHERE id = $1 AND organization_id = $2',
      [botId, request.organization.id]
    );
    if (bot.rows.length === 0) {
      throw new AppError('Bot no encontrado', 404);
    }

    const updated = await reprocessBotEmbeddings(botId);

    return {
      message: `Se re-procesaron ${updated} chunks con embeddings`,
      chunksUpdated: updated,
    };
  });

  // GET /api/bots/:id/embeddings/stats
  fastify.get('/:id/embeddings/stats', async (request) => {
    const botId = request.params.id;

    const bot = await query(
      'SELECT id FROM bots WHERE id = $1 AND organization_id = $2',
      [botId, request.organization.id]
    );
    if (bot.rows.length === 0) {
      throw new AppError('Bot no encontrado', 404);
    }

    return getEmbeddingStats(botId);
  });
}
