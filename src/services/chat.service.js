// ============================================
// BotFlow.ai — Chat Engine Service
// El corazón del producto: procesa mensajes,
// busca contexto, arma prompt, llama a Claude API
// ============================================

import { query, transaction } from '../db/index.js';
import { AppError } from './auth.service.js';
import { searchKnowledge } from './knowledge.service.js';
import { findMatchingQuickReply } from './quickreply.service.js';

// ============================================
// Procesar mensaje entrante
// ============================================

export async function processMessage({ botId, conversationId, visitorId, message, source }) {
  const startTime = Date.now();

  // 1. Obtener config del bot
  const bot = await getBotConfig(botId);
  if (!bot) {
    throw new AppError('Bot no encontrado o inactivo', 404);
  }

  // 2. Obtener o crear conversación
  let conversation;
  if (conversationId) {
    conversation = await getConversation(conversationId);
  }
  if (!conversation) {
    conversation = await createConversation(botId, visitorId, source);
  }

  // 3. Guardar mensaje del usuario
  await saveMessage({
    conversationId: conversation.id,
    botId,
    role: 'user',
    content: message,
  });

  // 4. Verificar quick replies primero (más rápido y barato que IA)
  const quickReply = await findMatchingQuickReply(botId, message);
  if (quickReply) {
    await saveMessage({
      conversationId: conversation.id,
      botId,
      role: 'assistant',
      content: quickReply,
      responseTimeMs: Date.now() - startTime,
    });

    return {
      conversationId: conversation.id,
      response: quickReply,
      source: 'quick_reply',
      responseTimeMs: Date.now() - startTime,
    };
  }

  // 5. Buscar contexto relevante en knowledge base
  const knowledgeContext = await searchKnowledge(botId, message, 5);

  // 6. Obtener historial reciente de la conversación
  const history = await getRecentHistory(conversation.id, 10);

  // 7. Armar el prompt completo
  const systemPrompt = buildSystemPrompt(bot, knowledgeContext);
  const messages = buildMessages(history, message);

  // 8. Llamar a Claude API
  const aiResponse = await callClaudeAPI(systemPrompt, messages, bot);

  const responseTimeMs = Date.now() - startTime;

  // 9. Guardar respuesta del asistente
  await saveMessage({
    conversationId: conversation.id,
    botId,
    role: 'assistant',
    content: aiResponse.content,
    modelUsed: aiResponse.model,
    tokensInput: aiResponse.usage?.input_tokens,
    tokensOutput: aiResponse.usage?.output_tokens,
    responseTimeMs,
    knowledgeChunksUsed: knowledgeContext.map(k => k.id),
  });

  // 10. Actualizar stats de uso
  await updateUsageStats(bot.organization_id, botId);

  return {
    conversationId: conversation.id,
    response: aiResponse.content,
    source: 'ai',
    model: aiResponse.model,
    responseTimeMs,
  };
}

// ============================================
// Armar system prompt con contexto
// ============================================

function buildSystemPrompt(bot, knowledgeContext) {
  let prompt = '';

  // Base: personalidad del bot
  const toneDescriptions = {
    professional: 'Respondé de manera profesional, clara y concisa.',
    friendly: 'Respondé de manera amigable, cálida y cercana. Usá emojis ocasionalmente.',
    casual: 'Respondé de manera informal y relajada, como un amigo.',
    formal: 'Respondé de manera formal y respetuosa, sin emojis.',
    custom: bot.custom_tone_description || 'Respondé de manera amigable.',
  };

  prompt += `Sos ${bot.name}, el asistente virtual de un negocio. `;
  prompt += toneDescriptions[bot.tone] || toneDescriptions.friendly;
  prompt += `\nIdioma: respondé siempre en ${bot.language === 'es' ? 'español' : bot.language}.\n`;

  // System prompt custom del negocio
  if (bot.system_prompt) {
    prompt += `\nInstrucciones del negocio:\n${bot.system_prompt}\n`;
  }

  // Contexto de knowledge base
  if (knowledgeContext.length > 0) {
    prompt += '\n--- INFORMACIÓN DEL NEGOCIO ---\n';
    prompt += 'Usá esta información para responder las consultas del cliente:\n\n';
    for (const chunk of knowledgeContext) {
      prompt += `[${chunk.source_title}]\n${chunk.content}\n\n`;
    }
    prompt += '--- FIN DE INFORMACIÓN ---\n';
  }

  // Reglas generales
  prompt += `
Reglas importantes:
- Solo respondé basándote en la información proporcionada. Si no sabés algo, decí que no tenés esa información.
- No inventes precios, horarios ni datos que no estén en la información del negocio.
- Sé conciso: respondé en 1-3 oraciones salvo que el cliente pida más detalle.
- Si el cliente quiere hablar con una persona real, informale que podés conectarlo con el equipo.
- ${bot.fallback_message ? `Si no podés responder, decí: "${bot.fallback_message}"` : ''}
`;

  return prompt;
}

// ============================================
// Armar array de mensajes con historial
// ============================================

function buildMessages(history, currentMessage) {
  const messages = [];

  // Agregar historial
  for (const msg of history) {
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  // Agregar mensaje actual
  messages.push({
    role: 'user',
    content: currentMessage,
  });

  return messages;
}

// ============================================
// Llamar a Claude API
// ============================================

async function callClaudeAPI(systemPrompt, messages, bot) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AppError('Claude API no configurada', 500);
  }

  const model = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5-20251001';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('❌ Claude API error:', response.status, error);
      throw new AppError(
        'Error al generar respuesta. Intentá de nuevo en un momento.',
        502
      );
    }

    const data = await response.json();

    return {
      content: data.content?.[0]?.text || 'No pude generar una respuesta.',
      model: data.model,
      usage: data.usage,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('❌ Error llamando a Claude API:', error.message);
    throw new AppError('Error de conexión con el servicio de IA', 502);
  }
}

// ============================================
// Streaming de Claude API (para WebSocket)
// ============================================

export async function processMessageStream({ botId, conversationId, visitorId, message, source, onChunk }) {
  const startTime = Date.now();
  const bot = await getBotConfig(botId);
  if (!bot) throw new AppError('Bot no encontrado', 404);

  let conversation;
  if (conversationId) conversation = await getConversation(conversationId);
  if (!conversation) conversation = await createConversation(botId, visitorId, source);

  await saveMessage({ conversationId: conversation.id, botId, role: 'user', content: message });

  // Quick reply check
  const quickReply = await findMatchingQuickReply(botId, message);
  if (quickReply) {
    onChunk(quickReply);
    await saveMessage({
      conversationId: conversation.id, botId, role: 'assistant',
      content: quickReply, responseTimeMs: Date.now() - startTime,
    });
    return { conversationId: conversation.id, source: 'quick_reply' };
  }

  const knowledgeContext = await searchKnowledge(botId, message, 5);
  const history = await getRecentHistory(conversation.id, 10);
  const systemPrompt = buildSystemPrompt(bot, knowledgeContext);
  const messages = buildMessages(history, message);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5-20251001';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    throw new AppError('Error al generar respuesta', 502);
  }

  // Procesar stream SSE
  let fullResponse = '';
  let usage = {};

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);

        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullResponse += event.delta.text;
          onChunk(event.delta.text);
        }

        if (event.type === 'message_delta' && event.usage) {
          usage = event.usage;
        }
      } catch {
        // Ignorar líneas no-JSON
      }
    }
  }

  const responseTimeMs = Date.now() - startTime;

  await saveMessage({
    conversationId: conversation.id, botId, role: 'assistant',
    content: fullResponse, modelUsed: model,
    tokensInput: usage.input_tokens, tokensOutput: usage.output_tokens,
    responseTimeMs, knowledgeChunksUsed: knowledgeContext.map(k => k.id),
  });

  await updateUsageStats(bot.organization_id, botId);

  return { conversationId: conversation.id, source: 'ai', model, responseTimeMs };
}

// ============================================
// DB Helpers
// ============================================

async function getBotConfig(botId) {
  // Aceptar tanto UUID como bot_id público
  const isPublicId = typeof botId === 'string' && botId.startsWith('bf_');
  const field = isPublicId ? 'bot_id' : 'id';

  const result = await query(
    `SELECT b.*, o.id as organization_id
     FROM bots b
     JOIN organizations o ON o.id = b.organization_id
     JOIN subscriptions s ON s.organization_id = o.id
     WHERE b.${field} = $1 AND b.is_active = TRUE
     AND s.status IN ('trialing', 'active')`,
    [botId]
  );

  return result.rows[0] || null;
}

async function getConversation(conversationId) {
  const result = await query(
    'SELECT * FROM conversations WHERE id = $1 AND is_active = TRUE',
    [conversationId]
  );
  return result.rows[0] || null;
}

async function createConversation(botId, visitorId, source) {
  // Obtener el UUID del bot si recibimos el bot_id público
  let botUuid = botId;
  if (typeof botId === 'string' && botId.startsWith('bf_')) {
    const r = await query('SELECT id FROM bots WHERE bot_id = $1', [botId]);
    botUuid = r.rows[0]?.id;
  }

  const result = await query(
    `INSERT INTO conversations (bot_id, visitor_id, source)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [botUuid, visitorId, source || 'web_widget']
  );
  return result.rows[0];
}

async function saveMessage({ conversationId, botId, role, content, modelUsed, tokensInput, tokensOutput, responseTimeMs, knowledgeChunksUsed }) {
  let botUuid = botId;
  if (typeof botId === 'string' && botId.startsWith('bf_')) {
    const r = await query('SELECT id FROM bots WHERE bot_id = $1', [botId]);
    botUuid = r.rows[0]?.id;
  }

  await query(
    `INSERT INTO messages 
     (conversation_id, bot_id, role, content, model_used, tokens_input, tokens_output, response_time_ms, knowledge_chunks_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [conversationId, botUuid, role, content, modelUsed || null, tokensInput || null, tokensOutput || null, responseTimeMs || null, knowledgeChunksUsed || null]
  );
}

async function getRecentHistory(conversationId, limit = 10) {
  const result = await query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.reverse(); // Orden cronológico
}

async function updateUsageStats(organizationId, botId) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  let botUuid = botId;
  if (typeof botId === 'string' && botId.startsWith('bf_')) {
    const r = await query('SELECT id FROM bots WHERE bot_id = $1', [botId]);
    botUuid = r.rows[0]?.id;
  }

  await query(
    `INSERT INTO usage_stats (organization_id, bot_id, period_start, period_end, conversations_count, messages_count)
     VALUES ($1, $2, $3, $4, 1, 1)
     ON CONFLICT (organization_id, bot_id, period_start)
     DO UPDATE SET 
       messages_count = usage_stats.messages_count + 1,
       updated_at = NOW()`,
    [organizationId, botUuid, periodStart, periodEnd]
  );
}

// ============================================
// Verificar límite de conversaciones del plan
// ============================================

export async function checkConversationLimit(botId) {
  const bot = await getBotConfig(botId);
  if (!bot) return false;

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await query(
    `SELECT COALESCE(SUM(conversations_count), 0) as total
     FROM usage_stats
     WHERE organization_id = $1 AND period_start = $2`,
    [bot.organization_id, periodStart]
  );

  const sub = await query(
    'SELECT max_conversations_per_month FROM subscriptions WHERE organization_id = $1',
    [bot.organization_id]
  );

  const used = parseInt(result.rows[0].total);
  const limit = sub.rows[0]?.max_conversations_per_month || 500;

  return used < limit;
}
