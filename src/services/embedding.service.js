// ============================================
// BotFlow.ai — Embedding Service
// Genera embeddings con Voyage AI (voyage-3.5-lite)
// y gestiona búsqueda semántica con pgvector
// ============================================

import { query } from '../db/index.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3.5-lite';
const EMBEDDING_DIMENSIONS = 1024;
const MAX_BATCH_SIZE = 128; // Voyage permite hasta 128 textos por request
const MAX_TOKENS_PER_TEXT = 4000; // Límite conservador por chunk

// ============================================
// Generar embeddings para un array de textos
// ============================================

export async function generateEmbeddings(texts, inputType = 'document') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ VOYAGE_API_KEY no configurada. Embeddings deshabilitados.');
    return null;
  }

  // Procesar en batches si hay muchos textos
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);

    // Truncar textos muy largos
    const truncated = batch.map(t =>
      t.length > MAX_TOKENS_PER_TEXT * 4 // ~4 chars por token aprox
        ? t.substring(0, MAX_TOKENS_PER_TEXT * 4)
        : t
    );

    try {
      const response = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: truncated,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('❌ Voyage API error:', response.status, error);
        throw new Error(`Voyage API error: ${response.status}`);
      }

      const data = await response.json();

      // Extraer embeddings en orden
      const embeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);

      allEmbeddings.push(...embeddings);
    } catch (error) {
      console.error('❌ Error generando embeddings:', error.message);
      // Para el batch que falló, poner nulls
      allEmbeddings.push(...new Array(batch.length).fill(null));
    }
  }

  return allEmbeddings;
}

// ============================================
// Generar embedding para un solo texto (query)
// ============================================

export async function generateQueryEmbedding(text) {
  const embeddings = await generateEmbeddings([text], 'query');
  return embeddings?.[0] || null;
}

// ============================================
// Procesar chunks y guardar con embeddings
// ============================================

export async function embedAndStoreChunks(sourceId, botId, chunks) {
  if (chunks.length === 0) return 0;

  const texts = chunks.map(c => c.text);
  const embeddings = await generateEmbeddings(texts, 'document');

  let stored = 0;

  for (let i = 0; i < chunks.length; i++) {
    const embedding = embeddings?.[i];

    if (embedding) {
      // Guardar con embedding
      await query(
        `INSERT INTO knowledge_chunks (source_id, bot_id, content, embedding, embedding_model, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6)`,
        [
          sourceId,
          botId,
          chunks[i].text,
          `[${embedding.join(',')}]`,
          EMBEDDING_MODEL,
          JSON.stringify({ position: chunks[i].position }),
        ]
      );
    } else {
      // Guardar sin embedding (fallback)
      await query(
        `INSERT INTO knowledge_chunks (source_id, bot_id, content, metadata)
         VALUES ($1, $2, $3, $4)`,
        [sourceId, botId, chunks[i].text, JSON.stringify({ position: chunks[i].position })]
      );
    }

    stored++;
  }

  return stored;
}

// ============================================
// Búsqueda semántica con pgvector
// Usa cosine similarity para encontrar los
// chunks más relevantes al query del usuario
// ============================================

export async function semanticSearch(botId, queryText, limit = 5) {
  // 1. Generar embedding del query
  const queryEmbedding = await generateQueryEmbedding(queryText);

  if (!queryEmbedding) {
    // Fallback a búsqueda por texto si embeddings no disponibles
    return textSearch(botId, queryText, limit);
  }

  // 2. Búsqueda vectorial con pgvector (cosine distance)
  const result = await query(
    `SELECT
       kc.id,
       kc.content,
       ks.title as source_title,
       ks.type as source_type,
       1 - (kc.embedding <=> $1::vector) as similarity
     FROM knowledge_chunks kc
     JOIN knowledge_sources ks ON ks.id = kc.source_id
     WHERE kc.bot_id = $2
     AND kc.embedding IS NOT NULL
     ORDER BY kc.embedding <=> $1::vector
     LIMIT $3`,
    [`[${queryEmbedding.join(',')}]`, botId, limit]
  );

  // Filtrar resultados con similarity muy baja
  const MIN_SIMILARITY = 0.3;
  const filtered = result.rows.filter(r => parseFloat(r.similarity) >= MIN_SIMILARITY);

  // Si no hay buenos resultados vectoriales, complementar con texto
  if (filtered.length < 2) {
    const textResults = await textSearch(botId, queryText, limit - filtered.length);
    // Combinar sin duplicados
    const existingIds = new Set(filtered.map(r => r.id));
    for (const tr of textResults) {
      if (!existingIds.has(tr.id)) {
        filtered.push(tr);
      }
    }
  }

  return filtered.slice(0, limit);
}

// ============================================
// Búsqueda por texto (fallback)
// Se usa cuando no hay embeddings disponibles
// ============================================

async function textSearch(botId, queryText, limit = 5) {
  // Tokenizar el query para buscar matches parciales
  const words = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5); // Máximo 5 palabras para la búsqueda

  if (words.length === 0) return [];

  // Construir condición OR para cada palabra
  const conditions = words.map((_, i) => `kc.content ILIKE $${i + 2}`);
  const params = [botId, ...words.map(w => `%${w}%`)];

  const result = await query(
    `SELECT
       kc.id,
       kc.content,
       ks.title as source_title,
       ks.type as source_type,
       0.5 as similarity
     FROM knowledge_chunks kc
     JOIN knowledge_sources ks ON ks.id = kc.source_id
     WHERE kc.bot_id = $1
     AND (${conditions.join(' OR ')})
     LIMIT ${limit}`,
    params
  );

  return result.rows;
}

// ============================================
// Re-procesar todos los chunks de un bot
// (para cuando se actualiza el modelo de embeddings)
// ============================================

export async function reprocessBotEmbeddings(botId) {
  const chunks = await query(
    `SELECT id, content FROM knowledge_chunks
     WHERE bot_id = $1
     ORDER BY created_at`,
    [botId]
  );

  if (chunks.rows.length === 0) return 0;

  const texts = chunks.rows.map(c => c.content);
  const embeddings = await generateEmbeddings(texts, 'document');

  let updated = 0;
  for (let i = 0; i < chunks.rows.length; i++) {
    if (embeddings?.[i]) {
      await query(
        `UPDATE knowledge_chunks
         SET embedding = $1::vector, embedding_model = $2
         WHERE id = $3`,
        [`[${embeddings[i].join(',')}]`, EMBEDDING_MODEL, chunks.rows[i].id]
      );
      updated++;
    }
  }

  return updated;
}

// ============================================
// Stats de embeddings de un bot
// ============================================

export async function getEmbeddingStats(botId) {
  const result = await query(
    `SELECT
       COUNT(*) as total_chunks,
       COUNT(embedding) as embedded_chunks,
       COUNT(*) - COUNT(embedding) as missing_embeddings,
       MAX(embedding_model) as model_used
     FROM knowledge_chunks
     WHERE bot_id = $1`,
    [botId]
  );

  return result.rows[0];
}
