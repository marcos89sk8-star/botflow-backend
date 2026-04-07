// ============================================
// BotFlow.ai — Analytics Routes
// GET /api/bots/:id/analytics           → Stats overview
// GET /api/bots/:id/conversations       → Lista de conversaciones
// GET /api/bots/:id/conversations/:cid  → Mensajes de una conversación
// ============================================

import { authenticate } from '../middleware/auth.js';
import { requireOrganization, requireActivePlan } from '../middleware/auth.js';
import * as AnalyticsService from '../services/analytics.service.js';

export default async function analyticsRoutes(fastify) {
  fastify.addHook('preHandler', authenticate(fastify));
  fastify.addHook('preHandler', requireOrganization());

  // GET /api/bots/:id/analytics
  fastify.get('/:id/analytics', async (request) => {
    return AnalyticsService.getDashboardStats(
      request.organization.id,
      request.params.id
    );
  });

  // GET /api/bots/:id/conversations
  fastify.get('/:id/conversations', async (request) => {
    const { page, limit } = request.query;
    return AnalyticsService.getConversationsList(
      request.params.id,
      request.organization.id,
      { page: parseInt(page) || 1, limit: parseInt(limit) || 20 }
    );
  });

  // GET /api/bots/:id/conversations/:cid
  fastify.get('/:id/conversations/:cid', async (request) => {
    return AnalyticsService.getConversationMessages(
      request.params.cid,
      request.params.id,
      request.organization.id
    );
  });
}
