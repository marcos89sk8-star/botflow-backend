// ============================================
// BotFlow.ai — Rutas de Auth
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/refresh
// POST /api/auth/logout
// GET  /api/auth/me
// GET  /api/auth/google
// GET  /api/auth/google/callback
// GET  /api/auth/github
// GET  /api/auth/github/callback
// ============================================

import {
  registerUser,
  loginUser,
  findOrCreateOAuthUser,
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  getUserProfile,
  AppError,
} from '../services/auth.service.js';

import {
  getGoogleAuthUrl,
  getGoogleUser,
  getGitHubAuthUrl,
  getGitHubUser,
} from '../services/oauth.service.js';

import { validate, registerSchema, loginSchema, refreshTokenSchema } from '../schemas.js';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';

// Helper para generar tokens JWT
function generateTokens(fastify, user) {
  const payload = { id: user.id, email: user.email, name: user.name };

  const accessToken = fastify.jwt.sign(payload, {
    expiresIn: config.jwt.expiresIn,
  });

  return { accessToken };
}

export default async function authRoutes(fastify) {
  // ============================================
  // POST /api/auth/register
  // ============================================
  fastify.post('/register', async (request, reply) => {
    const validation = validate(registerSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }

    const user = await registerUser(validation.data);

    const { accessToken } = generateTokens(fastify, user);
    const refreshToken = await createRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    return reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
      accessToken,
      refreshToken,
    });
  });

  // ============================================
  // POST /api/auth/login
  // ============================================
  fastify.post('/login', async (request, reply) => {
    const validation = validate(loginSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }

    const user = await loginUser(validation.data);

    const { accessToken } = generateTokens(fastify, user);
    const refreshToken = await createRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
      accessToken,
      refreshToken,
    };
  });

  // ============================================
  // POST /api/auth/refresh
  // ============================================
  fastify.post('/refresh', async (request, reply) => {
    const validation = validate(refreshTokenSchema, request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Datos inválidos', details: validation.errors });
    }

    const tokenData = await verifyRefreshToken(validation.data.refreshToken);

    // Revocar el token usado (rotación de refresh tokens)
    await revokeRefreshToken(validation.data.refreshToken);

    // Generar nuevos tokens
    const user = { id: tokenData.uid, email: tokenData.email, name: tokenData.name };
    const { accessToken } = generateTokens(fastify, user);
    const newRefreshToken = await createRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  });

  // ============================================
  // POST /api/auth/logout
  // ============================================
  fastify.post('/logout', {
    preHandler: [authenticate(fastify)],
  }, async (request, reply) => {
    const { refreshToken } = request.body || {};

    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    } else {
      // Revocar todos los tokens del usuario
      await revokeAllUserTokens(request.user.id);
    }

    return { message: 'Sesión cerrada correctamente' };
  });

  // ============================================
  // GET /api/auth/me
  // ============================================
  fastify.get('/me', {
    preHandler: [authenticate(fastify)],
  }, async (request, reply) => {
    const profile = await getUserProfile(request.user.id);
    return profile;
  });

  // ============================================
  // GET /api/auth/google
  // ============================================
  fastify.get('/google', async (request, reply) => {
    const url = getGoogleAuthUrl(request.query.state);
    return reply.redirect(url);
  });

  // ============================================
  // GET /api/auth/google/callback
  // ============================================
  fastify.get('/google/callback', async (request, reply) => {
    const { code } = request.query;
    if (!code) {
      throw new AppError('Código de autorización faltante', 400);
    }

    const googleUser = await getGoogleUser(code);
    const { user, isNew } = await findOrCreateOAuthUser(googleUser);

    const { accessToken } = generateTokens(fastify, user);
    const refreshToken = await createRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    // Redirigir al frontend con los tokens
    const frontendUrl = new URL('/auth/callback', config.cors.origin);
    frontendUrl.searchParams.set('accessToken', accessToken);
    frontendUrl.searchParams.set('refreshToken', refreshToken);
    frontendUrl.searchParams.set('isNew', isNew);

    return reply.redirect(frontendUrl.toString());
  });

  // ============================================
  // GET /api/auth/github
  // ============================================
  fastify.get('/github', async (request, reply) => {
    const url = getGitHubAuthUrl(request.query.state);
    return reply.redirect(url);
  });

  // ============================================
  // GET /api/auth/github/callback
  // ============================================
  fastify.get('/github/callback', async (request, reply) => {
    const { code } = request.query;
    if (!code) {
      throw new AppError('Código de autorización faltante', 400);
    }

    const githubUser = await getGitHubUser(code);
    const { user, isNew } = await findOrCreateOAuthUser(githubUser);

    const { accessToken } = generateTokens(fastify, user);
    const refreshToken = await createRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    const frontendUrl = new URL('/auth/callback', config.cors.origin);
    frontendUrl.searchParams.set('accessToken', accessToken);
    frontendUrl.searchParams.set('refreshToken', refreshToken);
    frontendUrl.searchParams.set('isNew', isNew);

    return reply.redirect(frontendUrl.toString());
  });
}
