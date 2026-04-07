-- ============================================
-- BotFlow.ai — Migración 002
-- Ajustar dimensión de embeddings a 1024
-- (voyage-3.5-lite usa 1024 dims)
-- ============================================

-- Borrar índice existente
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;

-- Cambiar dimensión del vector
ALTER TABLE knowledge_chunks
  ALTER COLUMN embedding TYPE vector(1024);

-- Recrear índice HNSW optimizado
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Agregar columna para tracking de modelo de embedding usado
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(50) DEFAULT 'voyage-3.5-lite';
