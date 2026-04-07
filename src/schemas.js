// ============================================
// BotFlow.ai — Schemas de validación (Zod)
// ============================================

import { z } from 'zod';

// ---- Auth ----

export const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(255),
});

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requerido'),
});

// ---- Organización ----

export const createOrgSchema = z.object({
  name: z.string().min(2).max(255),
  industry: z.string().max(100).optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
});

// ---- Bot ----

export const createBotSchema = z.object({
  name: z.string().min(1).max(255).default('Mi Bot'),
  tone: z.enum(['professional', 'friendly', 'casual', 'formal', 'custom']).default('friendly'),
  customToneDescription: z.string().max(500).optional(),
  language: z.string().max(10).default('es'),
  welcomeMessage: z.string().max(500).default('¡Hola! 👋 ¿En qué puedo ayudarte?'),
  fallbackMessage: z.string().max(500).default('No tengo información sobre eso. ¿Puedo ayudarte con algo más?'),
  systemPrompt: z.string().max(2000).optional(),
});

export const updateBotSchema = createBotSchema.partial().extend({
  isActive: z.boolean().optional(),
  collectEmail: z.boolean().optional(),
  collectPhone: z.boolean().optional(),
  humanHandoffEnabled: z.boolean().optional(),
  humanHandoffMessage: z.string().max(500).optional(),
  widgetPrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  widgetPosition: z.enum(['bottom-right', 'bottom-left']).optional(),
});

// ---- Knowledge Source ----

export const createKnowledgeSourceSchema = z.object({
  type: z.enum(['text', 'url', 'file', 'faq']),
  title: z.string().min(1).max(255),
  content: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});

// ---- Quick Reply ----

export const createQuickReplySchema = z.object({
  triggerText: z.string().min(1).max(255),
  responseText: z.string().min(1).max(2000),
  isExactMatch: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
});

// Helper para validar y extraer errores legibles
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return { success: false, errors };
  }
  return { success: true, data: result.data };
}
