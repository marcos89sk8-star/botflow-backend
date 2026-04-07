// ============================================
// BotFlow.ai — Analytics Service
// Métricas para el dashboard
// ============================================

import { query } from '../db/index.js';
import { AppError } from './auth.service.js';

// ============================================
// Dashboard overview stats
// ============================================

export async function getDashboardStats(organizationId, botId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Conversaciones este mes
  const convThisMonth = await query(
    `SELECT COUNT(*) as total FROM conversations
     WHERE bot_id = $1 AND started_at >= $2`,
    [botId, monthStart]
  );

  // Conversaciones mes anterior
  const convLastMonth = await query(
    `SELECT COUNT(*) as total FROM conversations
     WHERE bot_id = $1 AND started_at >= $2 AND started_at < $3`,
    [botId, prevMonthStart, monthStart]
  );

  // Mensajes totales este mes
  const msgsThisMonth = await query(
    `SELECT COUNT(*) as total FROM messages
     WHERE bot_id = $1 AND created_at >= $2`,
    [botId, monthStart]
  );

  // Tiempo de respuesta promedio (últimos 7 días)
  const avgResponse = await query(
    `SELECT AVG(response_time_ms) as avg_ms FROM messages
     WHERE bot_id = $1 AND role = 'assistant' AND response_time_ms IS NOT NULL
     AND created_at >= $2`,
    [botId, weekAgo]
  );

  // Conversaciones por día (últimos 7 días)
  const dailyConversations = await query(
    `SELECT DATE(started_at) as date, COUNT(*) as count
     FROM conversations
     WHERE bot_id = $1 AND started_at >= $2
     GROUP BY DATE(started_at)
     ORDER BY date`,
    [botId, weekAgo]
  );

  // Top quick replies usadas
  const topQuickReplies = await query(
    `SELECT qr.trigger_text, COUNT(m.id) as usage_count
     FROM quick_replies qr
     LEFT JOIN messages m ON m.content = qr.response_text AND m.bot_id = $1 AND m.role = 'assistant'
     WHERE qr.bot_id = $1
     GROUP BY qr.trigger_text
     ORDER BY usage_count DESC
     LIMIT 5`,
    [botId]
  );

  // Canales activos
  const activeChannels = await query(
    `SELECT type, status, last_message_at FROM channels
     WHERE bot_id = $1
     ORDER BY type`,
    [botId]
  );

  const thisMonth = parseInt(convThisMonth.rows[0].total);
  const lastMonth = parseInt(convLastMonth.rows[0].total);
  const growth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth * 100).toFixed(1) : 0;

  return {
    conversations: {
      thisMonth,
      lastMonth,
      growthPercent: parseFloat(growth),
    },
    messages: {
      thisMonth: parseInt(msgsThisMonth.rows[0].total),
    },
    avgResponseTimeMs: Math.round(parseFloat(avgResponse.rows[0].avg_ms) || 0),
    dailyConversations: dailyConversations.rows,
    topQuickReplies: topQuickReplies.rows,
    activeChannels: activeChannels.rows,
  };
}

// ============================================
// Historial de conversaciones (para el dashboard)
// ============================================

export async function getConversationsList(botId, organizationId, { page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const result = await query(
    `SELECT c.id, c.visitor_id, c.visitor_name, c.visitor_email, c.source,
            c.is_active, c.is_handed_off, c.message_count,
            c.started_at, c.last_message_at,
            (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
     FROM conversations c
     JOIN bots b ON b.id = c.bot_id
     WHERE c.bot_id = $1 AND b.organization_id = $2
     ORDER BY c.last_message_at DESC
     LIMIT $3 OFFSET $4`,
    [botId, organizationId, limit, offset]
  );

  const countResult = await query(
    `SELECT COUNT(*) as total FROM conversations c
     JOIN bots b ON b.id = c.bot_id
     WHERE c.bot_id = $1 AND b.organization_id = $2`,
    [botId, organizationId]
  );

  return {
    conversations: result.rows,
    total: parseInt(countResult.rows[0].total),
    page,
    totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
  };
}

// ============================================
// Mensajes de una conversación
// ============================================

export async function getConversationMessages(conversationId, botId, organizationId) {
  // Verificar ownership
  const conv = await query(
    `SELECT c.id FROM conversations c
     JOIN bots b ON b.id = c.bot_id
     WHERE c.id = $1 AND c.bot_id = $2 AND b.organization_id = $3`,
    [conversationId, botId, organizationId]
  );

  if (conv.rows.length === 0) {
    throw new AppError('Conversación no encontrada', 404);
  }

  const result = await query(
    `SELECT id, role, content, model_used, response_time_ms, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );

  return result.rows;
}
