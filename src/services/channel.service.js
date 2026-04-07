// ============================================
// BotFlow.ai — Channel Service
// Gestión de canales conectados a cada bot
// ============================================

import { query } from '../db/index.js';
import { AppError } from './auth.service.js';

// ============================================
// Obtener canales de un bot
// ============================================

export async function getChannels(botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `SELECT id, type, status, config, connected_at, last_message_at, created_at
     FROM channels
     WHERE bot_id = $1
     ORDER BY type`,
    [botId]
  );

  // Ocultar datos sensibles del config
  return result.rows.map(ch => ({
    ...ch,
    config: sanitizeConfig(ch.config),
  }));
}

// ============================================
// Conectar un canal
// ============================================

export async function connectChannel(botId, organizationId, channelType, channelConfig) {
  await verifyBotOwnership(botId, organizationId);

  // Verificar límite de canales según plan
  await checkChannelLimit(organizationId, botId);

  // Validar config según tipo de canal
  validateChannelConfig(channelType, channelConfig);

  const result = await query(
    `INSERT INTO channels (bot_id, type, status, config, connected_at)
     VALUES ($1, $2, 'connected', $3, NOW())
     ON CONFLICT (bot_id, type) 
     DO UPDATE SET status = 'connected', config = $3, connected_at = NOW()
     RETURNING *`,
    [botId, channelType, JSON.stringify(channelConfig)]
  );

  return {
    ...result.rows[0],
    config: sanitizeConfig(result.rows[0].config),
  };
}

// ============================================
// Desconectar un canal
// ============================================

export async function disconnectChannel(channelId, botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `UPDATE channels SET status = 'disconnected'
     WHERE id = $1 AND bot_id = $2
     RETURNING *`,
    [channelId, botId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Canal no encontrado', 404);
  }

  return result.rows[0];
}

// ============================================
// Eliminar canal
// ============================================

export async function deleteChannel(channelId, botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  // No permitir borrar web_widget (siempre debe existir)
  const channel = await query(
    'SELECT type FROM channels WHERE id = $1 AND bot_id = $2',
    [channelId, botId]
  );

  if (channel.rows.length === 0) {
    throw new AppError('Canal no encontrado', 404);
  }

  if (channel.rows[0].type === 'web_widget') {
    throw new AppError('No se puede eliminar el canal web widget', 400);
  }

  await query('DELETE FROM channels WHERE id = $1', [channelId]);
  return { deleted: true };
}

// ============================================
// Helpers
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

async function checkChannelLimit(organizationId, botId) {
  const sub = await query(
    'SELECT max_channels FROM subscriptions WHERE organization_id = $1',
    [organizationId]
  );

  const limit = sub.rows[0]?.max_channels || 1;

  const count = await query(
    `SELECT COUNT(*) as count FROM channels 
     WHERE bot_id = $1 AND status = 'connected'`,
    [botId]
  );

  if (parseInt(count.rows[0].count) >= limit) {
    throw new AppError(
      `Tu plan permite máximo ${limit} canal(es) conectado(s). Upgrade para conectar más.`,
      403
    );
  }
}

function validateChannelConfig(type, config) {
  switch (type) {
    case 'whatsapp':
      if (!config.twilioPhone) {
        throw new AppError('Se requiere número de WhatsApp (twilioPhone)', 400);
      }
      break;
    case 'telegram':
      if (!config.botToken) {
        throw new AppError('Se requiere el token del bot de Telegram (botToken)', 400);
      }
      break;
    case 'instagram':
    case 'messenger':
      if (!config.pageAccessToken) {
        throw new AppError('Se requiere el Page Access Token de Meta', 400);
      }
      break;
    case 'web_widget':
      // Config opcional
      break;
    case 'email':
      if (!config.email) {
        throw new AppError('Se requiere dirección de email', 400);
      }
      break;
    default:
      throw new AppError(`Tipo de canal no soportado: ${type}`, 400);
  }
}

function sanitizeConfig(config) {
  if (!config) return {};
  const sanitized = { ...config };
  // Ocultar tokens y credentials
  for (const key of Object.keys(sanitized)) {
    if (/token|secret|password|key|sid/i.test(key)) {
      const val = String(sanitized[key]);
      sanitized[key] = val.substring(0, 4) + '****' + val.substring(val.length - 4);
    }
  }
  return sanitized;
}
