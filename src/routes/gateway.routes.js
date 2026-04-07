// ============================================
// BotFlow.ai — API Gateway Routes
// Recibe mensajes de todos los canales y los
// rutea al Chat Engine
//
// POST /api/gateway/widget/:botId/message  → Widget web
// POST /api/gateway/whatsapp/webhook       → WhatsApp (Twilio)
// POST /api/gateway/telegram/webhook/:botId → Telegram
// GET  /api/gateway/widget/:botId/config   → Config pública del widget
// ============================================

import { processMessage, checkConversationLimit } from '../services/chat.service.js';
import { getPublicBotConfig } from '../services/bot.service.js';
import { AppError } from '../services/auth.service.js';
import { query } from '../db/index.js';

export default async function gatewayRoutes(fastify) {

  // ============================================
  // GET /api/gateway/widget/:botId/config
  // El widget lo llama al inicializar para obtener
  // la configuración pública del bot
  // ============================================
  fastify.get('/widget/:botId/config', async (request) => {
    const { botId } = request.params;
    return getPublicBotConfig(botId);
  });

  // ============================================
  // POST /api/gateway/widget/:botId/message
  // Recibe mensajes del widget web
  // ============================================
  fastify.post('/widget/:botId/message', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.ip + ':' + req.params.botId,
      },
    },
  }, async (request, reply) => {
    const { botId } = request.params;
    const { message, visitorId, conversationId } = request.body;

    if (!message || !visitorId) {
      throw new AppError('message y visitorId son requeridos', 400);
    }

    if (message.length > 2000) {
      throw new AppError('El mensaje no puede superar los 2000 caracteres', 400);
    }

    // Verificar límite de conversaciones
    const withinLimit = await checkConversationLimit(botId);
    if (!withinLimit) {
      throw new AppError(
        'Este bot alcanzó el límite de conversaciones de su plan.',
        429
      );
    }

    const result = await processMessage({
      botId,
      conversationId,
      visitorId,
      message: message.trim(),
      source: 'web_widget',
    });

    return result;
  });

  // ============================================
  // POST /api/gateway/whatsapp/webhook
  // Webhook de Twilio para WhatsApp
  // ============================================
  fastify.post('/whatsapp/webhook', async (request, reply) => {
    const body = request.body;

    // Twilio envía form-urlencoded
    const from = body.From;       // whatsapp:+5491155551234
    const to = body.To;           // whatsapp:+14155238886 (Twilio number)
    const messageBody = body.Body;
    const messageSid = body.MessageSid;

    if (!from || !messageBody) {
      return reply.code(200).send('OK'); // Twilio necesita 200
    }

    // Buscar qué bot tiene este número de WhatsApp
    const phoneNumber = to?.replace('whatsapp:', '');
    const channel = await query(
      `SELECT c.bot_id, b.bot_id as public_bot_id
       FROM channels c
       JOIN bots b ON b.id = c.bot_id
       WHERE c.type = 'whatsapp' 
       AND c.status = 'connected'
       AND c.config->>'twilioPhone' = $1`,
      [phoneNumber]
    );

    if (channel.rows.length === 0) {
      console.warn('⚠️ WhatsApp webhook: no bot found for', phoneNumber);
      return reply.code(200).send('OK');
    }

    const botPublicId = channel.rows[0].public_bot_id;
    const visitorId = `wa_${from.replace('whatsapp:', '').replace('+', '')}`;

    try {
      const result = await processMessage({
        botId: botPublicId,
        visitorId,
        message: messageBody.trim(),
        source: 'whatsapp',
      });

      // Responder via Twilio
      // En producción esto se hace con Twilio SDK
      // Por ahora devolvemos TwiML
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>${escapeXml(result.response)}</Message>
        </Response>`;

      return reply
        .code(200)
        .header('Content-Type', 'text/xml')
        .send(twiml);
    } catch (error) {
      console.error('❌ WhatsApp message error:', error.message);
      return reply.code(200).send('OK');
    }
  });

  // GET /api/gateway/whatsapp/webhook (validación de Twilio)
  fastify.get('/whatsapp/webhook', async (request, reply) => {
    return reply.code(200).send('OK');
  });

  // ============================================
  // POST /api/gateway/telegram/webhook/:token
  // Webhook de Telegram Bot API
  // ============================================
  fastify.post('/telegram/webhook/:token', async (request, reply) => {
    const { token } = request.params;
    const update = request.body;

    // Buscar bot por token de Telegram
    const channel = await query(
      `SELECT c.bot_id, b.bot_id as public_bot_id
       FROM channels c
       JOIN bots b ON b.id = c.bot_id
       WHERE c.type = 'telegram'
       AND c.status = 'connected'
       AND c.config->>'botToken' = $1`,
      [token]
    );

    if (channel.rows.length === 0) {
      return reply.code(200).send({ ok: true });
    }

    const message = update.message;
    if (!message || !message.text) {
      return reply.code(200).send({ ok: true });
    }

    const botPublicId = channel.rows[0].public_bot_id;
    const visitorId = `tg_${message.from.id}`;
    const chatId = message.chat.id;

    try {
      const result = await processMessage({
        botId: botPublicId,
        visitorId,
        message: message.text.trim(),
        source: 'telegram',
      });

      // Enviar respuesta via Telegram API
      const botToken = token;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: result.response,
          parse_mode: 'Markdown',
        }),
      });
    } catch (error) {
      console.error('❌ Telegram message error:', error.message);
    }

    return reply.code(200).send({ ok: true });
  });

  // ============================================
  // Analytics público del bot
  // GET /api/gateway/widget/:botId/quick-replies
  // ============================================
  fastify.get('/widget/:botId/quick-replies', async (request) => {
    const { botId } = request.params;

    const result = await query(
      `SELECT qr.trigger_text
       FROM quick_replies qr
       JOIN bots b ON b.id = qr.bot_id
       WHERE b.bot_id = $1 AND qr.is_active = TRUE
       ORDER BY qr.priority DESC
       LIMIT 5`,
      [botId]
    );

    return result.rows.map(r => r.trigger_text);
  });
}

// Helper para escapar XML (TwiML)
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
