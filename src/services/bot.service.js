// ============================================
// BotFlow.ai — Bot Service
// CRUD de bots + validación de límites
// ============================================

import { query, transaction } from '../db/index.js';
import { AppError } from './auth.service.js';
import { config } from '../config.js';

// Helper para generar bot_id único
function generateBotId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'bf_';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ============================================
// Obtener todos los bots de una org
// ============================================

export async function getBotsByOrg(organizationId) {
  const result = await query(
    `SELECT b.*,
       (SELECT COUNT(*) FROM channels c WHERE c.bot_id = b.id AND c.status = 'connected') as active_channels,
       (SELECT COUNT(*) FROM conversations cv WHERE cv.bot_id = b.id AND cv.started_at > NOW() - INTERVAL '30 days') as conversations_30d,
       (SELECT COUNT(*) FROM knowledge_sources ks WHERE ks.bot_id = b.id) as knowledge_sources_count
     FROM bots b
     WHERE b.organization_id = $1
     ORDER BY b.created_at DESC`,
    [organizationId]
  );
  return result.rows;
}

// ============================================
// Obtener un bot por ID (con validación de ownership)
// ============================================

export async function getBotById(botId, organizationId) {
  const result = await query(
    `SELECT b.*,
       json_agg(DISTINCT jsonb_build_object(
         'id', c.id, 'type', c.type, 'status', c.status, 'connected_at', c.connected_at
       )) FILTER (WHERE c.id IS NOT NULL) as channels
     FROM bots b
     LEFT JOIN channels c ON c.bot_id = b.id
     WHERE b.id = $1 AND b.organization_id = $2
     GROUP BY b.id`,
    [botId, organizationId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado', 404);
  }

  return result.rows[0];
}

// ============================================
// Obtener bot por bot_id público (para el widget/canales)
// ============================================

export async function getBotByPublicId(publicBotId) {
  const result = await query(
    `SELECT b.*, o.name as org_name,
       s.plan, s.status as plan_status,
       s.max_conversations_per_month
     FROM bots b
     JOIN organizations o ON o.id = b.organization_id
     JOIN subscriptions s ON s.organization_id = o.id
     WHERE b.bot_id = $1 AND b.is_active = TRUE`,
    [publicBotId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado o inactivo', 404);
  }

  const bot = result.rows[0];

  // Verificar plan activo
  if (!['trialing', 'active'].includes(bot.plan_status)) {
    throw new AppError('El servicio de este bot no está disponible actualmente', 402);
  }

  return bot;
}

// ============================================
// Crear bot
// ============================================

export async function createBot(organizationId, data) {
  // Verificar límite de bots (1 por org en MVP, después se puede expandir)
  const existing = await query(
    'SELECT COUNT(*) as count FROM bots WHERE organization_id = $1',
    [organizationId]
  );

  // Por ahora máximo 3 bots por org
  if (parseInt(existing.rows[0].count) >= 3) {
    throw new AppError('Alcanzaste el límite máximo de bots para tu cuenta', 403);
  }

  let botId = generateBotId();
  // Asegurar unicidad
  const idExists = await query('SELECT id FROM bots WHERE bot_id = $1', [botId]);
  if (idExists.rows.length > 0) {
    botId = generateBotId(); // retry una vez
  }

  const result = await transaction(async (client) => {
    const botResult = await client.query(
      `INSERT INTO bots 
       (organization_id, name, bot_id, tone, custom_tone_description, language, 
        welcome_message, fallback_message, system_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        organizationId,
        data.name || 'Mi Bot',
        botId,
        data.tone || 'friendly',
        data.customToneDescription || null,
        data.language || 'es',
        data.welcomeMessage || '¡Hola! 👋 ¿En qué puedo ayudarte?',
        data.fallbackMessage || 'No tengo información sobre eso. ¿Puedo ayudarte con algo más?',
        data.systemPrompt || null,
      ]
    );

    // Crear canal web widget por defecto
    await client.query(
      `INSERT INTO channels (bot_id, type, status, config)
       VALUES ($1, 'web_widget', 'connected', '{"allowedOrigins": ["*"]}')`,
      [botResult.rows[0].id]
    );

    return botResult.rows[0];
  });

  return result;
}

// ============================================
// Actualizar bot
// ============================================

export async function updateBot(botId, organizationId, data) {
  // Mapear camelCase a snake_case
  const fieldMap = {
    name: 'name',
    tone: 'tone',
    customToneDescription: 'custom_tone_description',
    language: 'language',
    welcomeMessage: 'welcome_message',
    fallbackMessage: 'fallback_message',
    systemPrompt: 'system_prompt',
    isActive: 'is_active',
    collectEmail: 'collect_email',
    collectPhone: 'collect_phone',
    humanHandoffEnabled: 'human_handoff_enabled',
    humanHandoffMessage: 'human_handoff_message',
    widgetPrimaryColor: 'widget_primary_color',
    widgetPosition: 'widget_position',
    widgetAvatarUrl: 'widget_avatar_url',
  };

  const sets = [];
  const values = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (data[jsKey] !== undefined) {
      sets.push(`${dbKey} = $${idx}`);
      values.push(data[jsKey]);
      idx++;
    }
  }

  if (sets.length === 0) {
    throw new AppError('No se enviaron campos para actualizar', 400);
  }

  values.push(botId, organizationId);

  const result = await query(
    `UPDATE bots SET ${sets.join(', ')}
     WHERE id = $${idx} AND organization_id = $${idx + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado', 404);
  }

  return result.rows[0];
}

// ============================================
// Eliminar bot
// ============================================

export async function deleteBot(botId, organizationId) {
  const result = await query(
    'DELETE FROM bots WHERE id = $1 AND organization_id = $2 RETURNING id',
    [botId, organizationId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado', 404);
  }

  return { deleted: true };
}

// ============================================
// Obtener config pública del bot (para widget)
// ============================================

export async function getPublicBotConfig(publicBotId) {
  const result = await query(
    `SELECT 
       b.bot_id, b.name, b.tone, b.language,
       b.welcome_message, b.widget_primary_color,
       b.widget_position, b.widget_avatar_url,
       b.collect_email, b.collect_phone
     FROM bots b
     WHERE b.bot_id = $1 AND b.is_active = TRUE`,
    [publicBotId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado', 404);
  }

  return result.rows[0];
}
