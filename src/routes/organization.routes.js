// ============================================
// BotFlow.ai — Rutas de Organización
// POST /api/organizations       → Crear org (onboarding)
// GET  /api/organizations/me    → Obtener mi org
// PUT  /api/organizations/me    → Actualizar mi org
// ============================================

import { query, transaction } from '../db/index.js';
import { validate, createOrgSchema } from '../schemas.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../services/auth.service.js';
import { config } from '../config.js';

// Helper para generar slug
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 50);
}

// Helper para generar bot_id único
function generateBotId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'bf_';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export default async function organizationRoutes(fastify) {
  // Todas las rutas requieren auth
  fastify.addHook('preHandler', authenticate(fastify));

  // ============================================
  // POST /api/organizations — Crear organización
  // Se llama durante el onboarding
  // ============================================
  fastify.post('/', async (request, reply) => {
    const validation = validate(createOrgSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }

    // Verificar que no tenga ya una org
    const existing = await query(
      'SELECT id FROM organizations WHERE owner_id = $1',
      [request.user.id]
    );
    if (existing.rows.length > 0) {
      throw new AppError('Ya tenés una organización creada', 409);
    }

    const { name, industry, websiteUrl, timezone } = validation.data;

    // Generar slug único
    let slug = slugify(name);
    const slugExists = await query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (slugExists.rows.length > 0) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // Crear org + suscripción trial + bot default en una transacción
    const result = await transaction(async (client) => {
      // 1. Crear organización
      const orgResult = await client.query(
        `INSERT INTO organizations (owner_id, name, slug, industry, website_url, timezone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [request.user.id, name, slug, industry, websiteUrl || null, timezone]
      );
      const org = orgResult.rows[0];

      // 2. Agregar owner como miembro
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [org.id, request.user.id]
      );

      // 3. Crear suscripción free trial
      const trialPlan = config.plans.free_trial;
      const subResult = await client.query(
        `INSERT INTO subscriptions 
         (organization_id, plan, status, max_channels, max_conversations_per_month, max_knowledge_sources)
         VALUES ($1, 'free_trial', 'trialing', $2, $3, $4)
         RETURNING *`,
        [org.id, trialPlan.maxChannels, trialPlan.maxConversationsPerMonth, trialPlan.maxKnowledgeSources]
      );

      // 4. Crear bot default
      const botId = generateBotId();
      const botResult = await client.query(
        `INSERT INTO bots (organization_id, name, bot_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [org.id, `Bot de ${name}`, botId]
      );

      // 5. Crear canal web widget por defecto
      await client.query(
        `INSERT INTO channels (bot_id, type, status, config)
         VALUES ($1, 'web_widget', 'connected', $2)`,
        [botResult.rows[0].id, JSON.stringify({ allowedOrigins: ['*'] })]
      );

      return {
        organization: org,
        subscription: subResult.rows[0],
        bot: botResult.rows[0],
      };
    });

    return reply.code(201).send(result);
  });

  // ============================================
  // GET /api/organizations/me
  // ============================================
  fastify.get('/me', async (request, reply) => {
    const result = await query(
      `SELECT o.*, s.plan, s.status as plan_status, s.trial_ends_at,
              s.max_channels, s.max_conversations_per_month
       FROM organizations o
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       WHERE o.owner_id = $1`,
      [request.user.id]
    );

    if (result.rows.length === 0) {
      throw new AppError('No tenés una organización creada. Completá el onboarding.', 404);
    }

    return result.rows[0];
  });

  // ============================================
  // PUT /api/organizations/me
  // ============================================
  fastify.put('/me', async (request, reply) => {
    const validation = validate(createOrgSchema.partial(), request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(validation.data)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
      fields.push(`${dbKey} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (fields.length === 0) {
      throw new AppError('No se enviaron campos para actualizar', 400);
    }

    values.push(request.user.id);
    const result = await query(
      `UPDATE organizations SET ${fields.join(', ')} 
       WHERE owner_id = $${idx} RETURNING *`,
      values
    );

    return result.rows[0];
  });
}
