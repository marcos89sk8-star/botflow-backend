// ============================================
// BotFlow.ai — Quick Reply Service
// CRUD de respuestas rápidas (trigger → respuesta)
// ============================================

import { query } from '../db/index.js';
import { AppError } from './auth.service.js';

// ============================================
// Obtener quick replies de un bot
// ============================================

export async function getQuickReplies(botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `SELECT id, trigger_text, response_text, is_exact_match, is_active, priority, created_at
     FROM quick_replies
     WHERE bot_id = $1
     ORDER BY priority DESC, created_at DESC`,
    [botId]
  );

  return result.rows;
}

// ============================================
// Crear quick reply
// ============================================

export async function createQuickReply(botId, organizationId, data) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `INSERT INTO quick_replies (bot_id, trigger_text, response_text, is_exact_match, priority)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [botId, data.triggerText, data.responseText, data.isExactMatch || false, data.priority || 0]
  );

  return result.rows[0];
}

// ============================================
// Actualizar quick reply
// ============================================

export async function updateQuickReply(replyId, botId, organizationId, data) {
  await verifyBotOwnership(botId, organizationId);

  const sets = [];
  const values = [];
  let idx = 1;

  const fieldMap = {
    triggerText: 'trigger_text',
    responseText: 'response_text',
    isExactMatch: 'is_exact_match',
    isActive: 'is_active',
    priority: 'priority',
  };

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

  values.push(replyId, botId);

  const result = await query(
    `UPDATE quick_replies SET ${sets.join(', ')}
     WHERE id = $${idx} AND bot_id = $${idx + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Quick reply no encontrada', 404);
  }

  return result.rows[0];
}

// ============================================
// Eliminar quick reply
// ============================================

export async function deleteQuickReply(replyId, botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    'DELETE FROM quick_replies WHERE id = $1 AND bot_id = $2 RETURNING id',
    [replyId, botId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Quick reply no encontrada', 404);
  }

  return { deleted: true };
}

// ============================================
// Buscar quick reply que matchee un mensaje
// (usado por el Chat Engine)
// ============================================

export async function findMatchingQuickReply(botId, messageText) {
  const normalized = messageText.toLowerCase().trim();

  // Primero buscar matches exactos
  let result = await query(
    `SELECT response_text FROM quick_replies
     WHERE bot_id = $1 AND is_active = TRUE AND is_exact_match = TRUE
     AND LOWER(trigger_text) = $2
     ORDER BY priority DESC
     LIMIT 1`,
    [botId, normalized]
  );

  if (result.rows.length > 0) {
    return result.rows[0].response_text;
  }

  // Después buscar matches parciales (contiene)
  result = await query(
    `SELECT response_text FROM quick_replies
     WHERE bot_id = $1 AND is_active = TRUE AND is_exact_match = FALSE
     AND $2 ILIKE '%' || trigger_text || '%'
     ORDER BY priority DESC
     LIMIT 1`,
    [botId, normalized]
  );

  return result.rows.length > 0 ? result.rows[0].response_text : null;
}

// ============================================
// Helper
// ============================================

async function verifyBotOwnership(botId, organizationId) {
  const result = await query(
    'SELECT id FROM bots WHERE id = $1 AND organization_id = $2',
    [botId, organizationId]
  );
  if (result.rows.length === 0) {
    throw new AppError('Bot no encontrado', 404);
  }
}
