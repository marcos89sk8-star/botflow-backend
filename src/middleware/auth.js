// ============================================
// BotFlow.ai — Middleware de Autenticación
// ============================================

import { AppError } from '../services/auth.service.js';

// ============================================
// Middleware: requiere JWT válido
// ============================================

export function authenticate(fastify) {
  return async function (request, reply) {
    try {
      // @fastify/jwt agrega request.jwtVerify()
      await request.jwtVerify();
    } catch (err) {
      throw new AppError('Token inválido o expirado. Iniciá sesión de nuevo.', 401);
    }
  };
}

// ============================================
// Middleware: requiere organización
// (el usuario debe tener una org asociada)
// ============================================

export function requireOrganization() {
  return async function (request, reply) {
    const { rows } = await request.server.db.query(
      `SELECT o.id, o.slug, s.plan, s.status 
       FROM organizations o
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       WHERE o.owner_id = $1`,
      [request.user.id]
    );

    if (rows.length === 0) {
      throw new AppError('Necesitás crear una organización primero', 403);
    }

    // Adjuntar org al request
    request.organization = {
      id: rows[0].id,
      slug: rows[0].slug,
      plan: rows[0].plan,
      planStatus: rows[0].status,
    };
  };
}

// ============================================
// Middleware: requiere plan activo
// ============================================

export function requireActivePlan() {
  return async function (request, reply) {
    const org = request.organization;
    if (!org) {
      throw new AppError('Organización no encontrada', 403);
    }

    const validStatuses = ['trialing', 'active'];
    if (!validStatuses.includes(org.planStatus)) {
      throw new AppError(
        'Tu plan está inactivo. Actualizá tu suscripción para continuar.',
        402
      );
    }
  };
}

// ============================================
// Middleware: requiere feature del plan
// ============================================

export function requireFeature(feature) {
  return async function (request, reply) {
    const { config: appConfig } = await import('../config.js');
    const plan = request.organization?.plan || 'free_trial';
    const planConfig = appConfig.plans[plan];

    if (!planConfig?.features.includes(feature)) {
      throw new AppError(
        `Tu plan actual no incluye esta funcionalidad. Upgrade a un plan superior.`,
        403
      );
    }
  };
}
