// ============================================
// BotFlow.ai — Configuración central
// ============================================

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-cambiar',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-cambiar',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackUrl: process.env.GITHUB_CALLBACK_URL,
    },
  },

  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },

  // Límites por plan
  plans: {
    free_trial: {
      maxChannels: 1,
      maxConversationsPerMonth: 100,
      maxKnowledgeSources: 3,
      features: ['basic_ai', 'basic_analytics'],
    },
    basic: {
      price: 29,
      maxChannels: 1,
      maxConversationsPerMonth: 500,
      maxKnowledgeSources: 5,
      features: ['basic_ai', 'basic_analytics'],
    },
    professional: {
      price: 79,
      maxChannels: 3,
      maxConversationsPerMonth: 3000,
      maxKnowledgeSources: 20,
      features: ['advanced_ai', 'full_analytics', 'human_handoff', 'crm_integration'],
    },
    premium: {
      price: 199,
      maxChannels: 999, // "ilimitado"
      maxConversationsPerMonth: 999999,
      maxKnowledgeSources: 999,
      features: ['premium_ai', 'advanced_analytics', 'human_handoff', 'all_integrations', 'api_access', 'custom_training'],
    },
  },
};

// Helpers de tiempo para parsear duraciones JWT
export function parseExpiresIn(str) {
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) return 900; // 15m default
  const [, num, unit] = match;
  const multipliers = { m: 60, h: 3600, d: 86400 };
  return parseInt(num) * multipliers[unit];
}
