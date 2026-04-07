-- ============================================
-- BotFlow.ai — Esquema de Base de Datos
-- Migración inicial: todas las tablas core
-- ============================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector para búsqueda semántica

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE plan_type AS ENUM ('free_trial', 'basic', 'professional', 'premium');
CREATE TYPE plan_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired');
CREATE TYPE channel_type AS ENUM ('web_widget', 'whatsapp', 'instagram', 'messenger', 'telegram', 'email');
CREATE TYPE channel_status AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE message_source AS ENUM ('web_widget', 'whatsapp', 'instagram', 'messenger', 'telegram', 'email', 'dashboard');
CREATE TYPE oauth_provider AS ENUM ('google', 'github');
CREATE TYPE knowledge_source_type AS ENUM ('text', 'url', 'file', 'faq');
CREATE TYPE bot_tone AS ENUM ('professional', 'friendly', 'casual', 'formal', 'custom');

-- ============================================
-- TABLA: users
-- Usuarios de la plataforma (dueños de negocios)
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),  -- NULL si usa solo OAuth
  name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  
  -- OAuth
  oauth_provider oauth_provider,
  oauth_provider_id VARCHAR(255),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT users_oauth_unique UNIQUE (oauth_provider, oauth_provider_id)
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- TABLA: refresh_tokens
-- Tokens de refresco para mantener sesión
-- ============================================

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============================================
-- TABLA: organizations
-- Negocios/empresas que usan la plataforma
-- ============================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,  -- URL-friendly name
  industry VARCHAR(100),
  website_url TEXT,
  logo_url TEXT,
  timezone VARCHAR(50) DEFAULT 'America/Argentina/Buenos_Aires',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_owner ON organizations(owner_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);

-- ============================================
-- TABLA: organization_members
-- Miembros del equipo (para plan Premium)
-- ============================================

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role DEFAULT 'member',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT org_member_unique UNIQUE (organization_id, user_id)
);

-- ============================================
-- TABLA: subscriptions
-- Suscripciones y planes activos
-- ============================================

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Plan
  plan plan_type NOT NULL DEFAULT 'free_trial',
  status plan_status NOT NULL DEFAULT 'trialing',
  
  -- Límites del plan (desnormalizados para consultas rápidas)
  max_channels INT NOT NULL DEFAULT 1,
  max_conversations_per_month INT NOT NULL DEFAULT 500,
  max_knowledge_sources INT NOT NULL DEFAULT 5,
  
  -- Fechas
  trial_starts_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  
  -- Stripe / Mercado Pago
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  mp_customer_id VARCHAR(255),
  mp_subscription_id VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- ============================================
-- TABLA: bots
-- Chatbots configurados por cada negocio
-- ============================================

CREATE TABLE bots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Identidad
  name VARCHAR(255) NOT NULL DEFAULT 'Mi Bot',
  bot_id VARCHAR(20) UNIQUE NOT NULL,  -- ID público corto (ej: "bf_a1b2c3")
  
  -- Personalidad
  tone bot_tone DEFAULT 'friendly',
  custom_tone_description TEXT,
  language VARCHAR(10) DEFAULT 'es',
  welcome_message TEXT DEFAULT '¡Hola! 👋 ¿En qué puedo ayudarte?',
  fallback_message TEXT DEFAULT 'No tengo información sobre eso. ¿Puedo ayudarte con algo más?',
  
  -- Instrucciones para la IA
  system_prompt TEXT,  -- Prompt base personalizado
  
  -- Configuración
  is_active BOOLEAN DEFAULT TRUE,
  collect_email BOOLEAN DEFAULT FALSE,
  collect_phone BOOLEAN DEFAULT FALSE,
  human_handoff_enabled BOOLEAN DEFAULT FALSE,
  human_handoff_message TEXT DEFAULT 'Te conecto con un agente humano...',
  
  -- Apariencia del widget
  widget_primary_color VARCHAR(7) DEFAULT '#4ade80',
  widget_position VARCHAR(20) DEFAULT 'bottom-right',
  widget_avatar_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bots_org ON bots(organization_id);
CREATE INDEX idx_bots_bot_id ON bots(bot_id);

-- ============================================
-- TABLA: channels
-- Canales conectados a cada bot
-- ============================================

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  type channel_type NOT NULL,
  status channel_status DEFAULT 'disconnected',
  
  -- Credenciales/config del canal (encriptadas en prod)
  config JSONB DEFAULT '{}',
  -- Ejemplo WhatsApp: { "twilio_phone": "+54...", "twilio_sid": "..." }
  -- Ejemplo Telegram: { "bot_token": "...", "webhook_url": "..." }
  -- Ejemplo Web Widget: { "allowed_origins": ["https://misite.com"] }
  
  connected_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT channel_bot_type_unique UNIQUE (bot_id, type)
);

CREATE INDEX idx_channels_bot ON channels(bot_id);

-- ============================================
-- TABLA: knowledge_sources
-- Fuentes de conocimiento del bot
-- ============================================

CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  type knowledge_source_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT,  -- Contenido raw
  source_url TEXT,  -- Si es URL
  file_url TEXT,  -- Si es archivo subido
  
  -- Estado de procesamiento
  is_processed BOOLEAN DEFAULT FALSE,
  chunk_count INT DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_sources_bot ON knowledge_sources(bot_id);

-- ============================================
-- TABLA: knowledge_chunks
-- Fragmentos indexados para búsqueda semántica
-- ============================================

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  content TEXT NOT NULL,
  embedding vector(1536),  -- Dimensión del embedding
  
  -- Metadata para filtrado
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_chunks_bot ON knowledge_chunks(bot_id);
CREATE INDEX idx_knowledge_chunks_source ON knowledge_chunks(source_id);

-- Índice HNSW para búsqueda vectorial rápida
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================
-- TABLA: quick_replies
-- Respuestas rápidas (trigger → respuesta)
-- ============================================

CREATE TABLE quick_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  trigger_text VARCHAR(255) NOT NULL,  -- Ej: "horarios"
  response_text TEXT NOT NULL,  -- Ej: "Estamos abiertos de 8 a 20hs"
  is_exact_match BOOLEAN DEFAULT FALSE,  -- TRUE = match exacto, FALSE = contiene
  is_active BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 0,  -- Mayor prioridad se evalúa primero
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quick_replies_bot ON quick_replies(bot_id);

-- ============================================
-- TABLA: conversations
-- Conversaciones entre clientes y bots
-- ============================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  -- Info del cliente (visitor)
  visitor_id VARCHAR(255) NOT NULL,  -- ID único del visitante
  visitor_name VARCHAR(255),
  visitor_email VARCHAR(255),
  visitor_phone VARCHAR(50),
  
  -- Canal de la conversación
  source message_source NOT NULL,
  channel_id UUID REFERENCES channels(id),
  
  -- Estado
  is_active BOOLEAN DEFAULT TRUE,
  is_handed_off BOOLEAN DEFAULT FALSE,  -- Escalada a humano
  handed_off_to UUID REFERENCES users(id),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  message_count INT DEFAULT 0,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_bot ON conversations(bot_id);
CREATE INDEX idx_conversations_visitor ON conversations(visitor_id);
CREATE INDEX idx_conversations_dates ON conversations(bot_id, started_at DESC);

-- ============================================
-- TABLA: messages
-- Mensajes individuales en cada conversación
-- ============================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  
  role message_role NOT NULL,
  content TEXT NOT NULL,
  
  -- Metadata de IA
  model_used VARCHAR(50),  -- Ej: "claude-haiku-4-5-20251001"
  tokens_input INT,
  tokens_output INT,
  response_time_ms INT,  -- Tiempo de respuesta en ms
  
  -- Contexto usado
  knowledge_chunks_used UUID[],  -- IDs de chunks que se usaron como contexto
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_bot ON messages(bot_id, created_at DESC);

-- ============================================
-- TABLA: usage_stats
-- Estadísticas de uso por período (para control de límites)
-- ============================================

CREATE TABLE usage_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
  
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  conversations_count INT DEFAULT 0,
  messages_count INT DEFAULT 0,
  tokens_used INT DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT usage_stats_unique UNIQUE (organization_id, bot_id, period_start)
);

CREATE INDEX idx_usage_stats_org ON usage_stats(organization_id, period_start);

-- ============================================
-- FUNCIÓN: Actualizar updated_at automáticamente
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a todas las tablas con updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bots FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON knowledge_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quick_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON usage_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- FUNCIÓN: Incrementar contador de mensajes en conversación
-- ============================================

CREATE OR REPLACE FUNCTION increment_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET message_count = message_count + 1,
      last_message_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_message_insert
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION increment_message_count();
