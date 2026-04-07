// ============================================
// BotFlow.ai — Rutas de Bots
// GET    /api/bots           → Listar bots
// POST   /api/bots           → Crear bot
// GET    /api/bots/:id       → Obtener bot
// PUT    /api/bots/:id       → Actualizar bot
// DELETE /api/bots/:id       → Eliminar bot
//
// Sub-rutas de Knowledge Base:
// GET    /api/bots/:id/knowledge       → Listar fuentes
// POST   /api/bots/:id/knowledge       → Crear fuente
// PUT    /api/bots/:id/knowledge/:sid  → Actualizar fuente
// DELETE /api/bots/:id/knowledge/:sid  → Eliminar fuente
//
// Sub-rutas de Quick Replies:
// GET    /api/bots/:id/quick-replies       → Listar
// POST   /api/bots/:id/quick-replies       → Crear
// PUT    /api/bots/:id/quick-replies/:rid  → Actualizar
// DELETE /api/bots/:id/quick-replies/:rid  → Eliminar
//
// Sub-rutas de Channels:
// GET    /api/bots/:id/channels            → Listar canales
// POST   /api/bots/:id/channels            → Conectar canal
// PUT    /api/bots/:id/channels/:cid/disconnect → Desconectar
// DELETE /api/bots/:id/channels/:cid       → Eliminar canal
// ============================================

import { authenticate } from '../middleware/auth.js';
import { requireOrganization, requireActivePlan } from '../middleware/auth.js';
import { validate, createBotSchema, updateBotSchema, createKnowledgeSourceSchema, createQuickReplySchema } from '../schemas.js';

import * as BotService from '../services/bot.service.js';
import * as KnowledgeService from '../services/knowledge.service.js';
import * as QuickReplyService from '../services/quickreply.service.js';
import * as ChannelService from '../services/channel.service.js';

export default async function botRoutes(fastify) {
  // Todas las rutas requieren auth + org + plan activo
  fastify.addHook('preHandler', authenticate(fastify));
  fastify.addHook('preHandler', requireOrganization());
  fastify.addHook('preHandler', requireActivePlan());

  // ==============================
  // BOTS CRUD
  // ==============================

  // GET /api/bots
  fastify.get('/', async (request) => {
    return BotService.getBotsByOrg(request.organization.id);
  });

  // POST /api/bots
  fastify.post('/', async (request, reply) => {
    const validation = validate(createBotSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }
    const bot = await BotService.createBot(request.organization.id, validation.data);
    return reply.code(201).send(bot);
  });

  // GET /api/bots/:id
  fastify.get('/:id', async (request) => {
    return BotService.getBotById(request.params.id, request.organization.id);
  });

  // PUT /api/bots/:id
  fastify.put('/:id', async (request, reply) => {
    const validation = validate(updateBotSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }
    return BotService.updateBot(request.params.id, request.organization.id, validation.data);
  });

  // DELETE /api/bots/:id
  fastify.delete('/:id', async (request) => {
    return BotService.deleteBot(request.params.id, request.organization.id);
  });

  // ==============================
  // KNOWLEDGE BASE
  // ==============================

  // GET /api/bots/:id/knowledge
  fastify.get('/:id/knowledge', async (request) => {
    return KnowledgeService.getKnowledgeSources(request.params.id, request.organization.id);
  });

  // POST /api/bots/:id/knowledge
  fastify.post('/:id/knowledge', async (request, reply) => {
    const validation = validate(createKnowledgeSourceSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }
    const source = await KnowledgeService.createKnowledgeSource(
      request.params.id, request.organization.id, validation.data
    );
    return reply.code(201).send(source);
  });

  // PUT /api/bots/:id/knowledge/:sid
  fastify.put('/:id/knowledge/:sid', async (request) => {
    return KnowledgeService.updateKnowledgeSource(
      request.params.sid, request.params.id, request.organization.id, request.body
    );
  });

  // DELETE /api/bots/:id/knowledge/:sid
  fastify.delete('/:id/knowledge/:sid', async (request) => {
    return KnowledgeService.deleteKnowledgeSource(
      request.params.sid, request.params.id, request.organization.id
    );
  });

  // ==============================
  // QUICK REPLIES
  // ==============================

  // GET /api/bots/:id/quick-replies
  fastify.get('/:id/quick-replies', async (request) => {
    return QuickReplyService.getQuickReplies(request.params.id, request.organization.id);
  });

  // POST /api/bots/:id/quick-replies
  fastify.post('/:id/quick-replies', async (request, reply) => {
    const validation = validate(createQuickReplySchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }
    const qr = await QuickReplyService.createQuickReply(
      request.params.id, request.organization.id, validation.data
    );
    return reply.code(201).send(qr);
  });

  // PUT /api/bots/:id/quick-replies/:rid
  fastify.put('/:id/quick-replies/:rid', async (request) => {
    return QuickReplyService.updateQuickReply(
      request.params.rid, request.params.id, request.organization.id, request.body
    );
  });

  // DELETE /api/bots/:id/quick-replies/:rid
  fastify.delete('/:id/quick-replies/:rid', async (request) => {
    return QuickReplyService.deleteQuickReply(
      request.params.rid, request.params.id, request.organization.id
    );
  });

  // ==============================
  // CHANNELS
  // ==============================

  // GET /api/bots/:id/channels
  fastify.get('/:id/channels', async (request) => {
    return ChannelService.getChannels(request.params.id, request.organization.id);
  });

  // POST /api/bots/:id/channels
  fastify.post('/:id/channels', async (request, reply) => {
    const { type, config } = request.body;
    if (!type) {
      return reply.code(400).send({ error: 'El tipo de canal es requerido' });
    }
    const channel = await ChannelService.connectChannel(
      request.params.id, request.organization.id, type, config || {}
    );
    return reply.code(201).send(channel);
  });

  // PUT /api/bots/:id/channels/:cid/disconnect
  fastify.put('/:id/channels/:cid/disconnect', async (request) => {
    return ChannelService.disconnectChannel(
      request.params.cid, request.params.id, request.organization.id
    );
  });

  // DELETE /api/bots/:id/channels/:cid
  fastify.delete('/:id/channels/:cid', async (request) => {
    return ChannelService.deleteChannel(
      request.params.cid, request.params.id, request.organization.id
    );
  });
}
