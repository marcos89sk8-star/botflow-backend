// ============================================
// BotFlow.ai — Knowledge Base Service
// CRUD de knowledge sources + chunks
// ============================================

import { query, transaction } from '../db/index.js';
import { AppError } from './auth.service.js';
import { embedAndStoreChunks } from './embedding.service.js';

// ============================================
// Obtener todas las fuentes de un bot
// ============================================

export async function getKnowledgeSources(botId, organizationId) {
  // Verificar ownership
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `SELECT id, type, title, content, source_url, is_processed, chunk_count, 
            last_processed_at, created_at, updated_at
     FROM knowledge_sources
     WHERE bot_id = $1
     ORDER BY created_at DESC`,
    [botId]
  );

  return result.rows;
}

// ============================================
// Obtener una fuente por ID
// ============================================

export async function getKnowledgeSource(sourceId, botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  const result = await query(
    `SELECT * FROM knowledge_sources WHERE id = $1 AND bot_id = $2`,
    [sourceId, botId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Fuente de conocimiento no encontrada', 404);
  }

  return result.rows[0];
}

// ============================================
// Crear fuente de conocimiento
// ============================================

export async function createKnowledgeSource(botId, organizationId, data) {
  await verifyBotOwnership(botId, organizationId);

  // Verificar límite de fuentes según plan
  await checkKnowledgeLimit(organizationId, botId);

  const result = await query(
    `INSERT INTO knowledge_sources (bot_id, type, title, content, source_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [botId, data.type, data.title, data.content || null, data.sourceUrl || null]
  );

  const source = result.rows[0];

  // Si es texto o FAQ, procesar inmediatamente (crear chunks)
  if (['text', 'faq'].includes(data.type) && data.content) {
    await processTextSource(source.id, botId, data.content);
  }

  return source;
}

// ============================================
// Actualizar fuente de conocimiento
// ============================================

export async function updateKnowledgeSource(sourceId, botId, organizationId, data) {
  await verifyBotOwnership(botId, organizationId);

  const sets = [];
  const values = [];
  let idx = 1;

  if (data.title !== undefined) { sets.push(`title = $${idx}`); values.push(data.title); idx++; }
  if (data.content !== undefined) { sets.push(`content = $${idx}`); values.push(data.content); idx++; }
  if (data.sourceUrl !== undefined) { sets.push(`source_url = $${idx}`); values.push(data.sourceUrl); idx++; }

  if (sets.length === 0) {
    throw new AppError('No se enviaron campos para actualizar', 400);
  }

  // Marcar como no procesado si cambió el contenido
  if (data.content !== undefined) {
    sets.push(`is_processed = FALSE`);
  }

  values.push(sourceId, botId);

  const result = await query(
    `UPDATE knowledge_sources SET ${sets.join(', ')}
     WHERE id = $${idx} AND bot_id = $${idx + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Fuente de conocimiento no encontrada', 404);
  }

  // Re-procesar si cambió el contenido
  if (data.content !== undefined) {
    await processTextSource(sourceId, botId, data.content);
  }

  return result.rows[0];
}

// ============================================
// Eliminar fuente de conocimiento
// ============================================

export async function deleteKnowledgeSource(sourceId, botId, organizationId) {
  await verifyBotOwnership(botId, organizationId);

  // CASCADE borra los chunks automáticamente
  const result = await query(
    'DELETE FROM knowledge_sources WHERE id = $1 AND bot_id = $2 RETURNING id',
    [sourceId, botId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Fuente de conocimiento no encontrada', 404);
  }

  return { deleted: true };
}

// ============================================
// Procesar texto en chunks (para búsqueda semántica)
// Por ahora chunks simples, después se agrega embedding
// ============================================

async function processTextSource(sourceId, botId, content) {
  // Borrar chunks anteriores de esta fuente
  await query(
    'DELETE FROM knowledge_chunks WHERE source_id = $1',
    [sourceId]
  );

  // Dividir contenido en chunks de ~500 chars con overlap
  const chunks = splitIntoChunks(content, 500, 50);

  // Generar embeddings y guardar chunks con vectores
  const stored = await embedAndStoreChunks(sourceId, botId, chunks);

  // Actualizar estado de la fuente
  await query(
    `UPDATE knowledge_sources 
     SET is_processed = TRUE, chunk_count = $1, last_processed_at = NOW()
     WHERE id = $2`,
    [stored, sourceId]
  );

  return stored;
}

// ============================================
// Búsqueda en knowledge base (semántica + texto)
// Usa pgvector para cosine similarity, con
// fallback a búsqueda por texto
// ============================================

export { semanticSearch as searchKnowledge } from './embedding.service.js';

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

async function checkKnowledgeLimit(organizationId, botId) {
  const sub = await query(
    'SELECT max_knowledge_sources FROM subscriptions WHERE organization_id = $1',
    [organizationId]
  );

  const limit = sub.rows[0]?.max_knowledge_sources || 5;

  const count = await query(
    'SELECT COUNT(*) as count FROM knowledge_sources WHERE bot_id = $1',
    [botId]
  );

  if (parseInt(count.rows[0].count) >= limit) {
    throw new AppError(
      `Alcanzaste el límite de ${limit} fuentes de conocimiento para tu plan. Upgrade para agregar más.`,
      403
    );
  }
}

function splitIntoChunks(text, maxSize = 500, overlap = 50) {
  const chunks = [];
  // Dividir por párrafos primero
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  let position = 0;

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length > maxSize && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), position });
      position++;
      // Overlap: mantener las últimas palabras
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.ceil(overlap / 5)).join(' ');
      currentChunk = overlapWords + '\n\n' + para;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), position });
  }

  // Si un chunk es muy largo, partirlo por oraciones
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.text.length > maxSize * 1.5) {
      const sentences = chunk.text.split(/(?<=[.!?])\s+/);
      let subChunk = '';
      for (const sentence of sentences) {
        if ((subChunk + ' ' + sentence).length > maxSize && subChunk.length > 0) {
          finalChunks.push({ text: subChunk.trim(), position: finalChunks.length });
          subChunk = sentence;
        } else {
          subChunk = subChunk ? subChunk + ' ' + sentence : sentence;
        }
      }
      if (subChunk.trim()) {
        finalChunks.push({ text: subChunk.trim(), position: finalChunks.length });
      }
    } else {
      finalChunks.push({ ...chunk, position: finalChunks.length });
    }
  }

  return finalChunks;
}
