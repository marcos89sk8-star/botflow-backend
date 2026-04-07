// ============================================
// BotFlow.ai — Auth Service
// Registro, login, JWT, refresh tokens, OAuth
// ============================================

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, transaction } from '../db/index.js';
import { config, parseExpiresIn } from '../config.js';

const SALT_ROUNDS = 12;

// ============================================
// Registro con email/password
// ============================================

export async function registerUser({ email, password, name }) {
  // Verificar que el email no exista
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new AppError('Ya existe una cuenta con ese email', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await query(
    `INSERT INTO users (email, password_hash, name) 
     VALUES ($1, $2, $3) 
     RETURNING id, email, name, avatar_url, created_at`,
    [email, passwordHash, name]
  );

  return result.rows[0];
}

// ============================================
// Login con email/password
// ============================================

export async function loginUser({ email, password }) {
  const result = await query(
    `SELECT id, email, name, avatar_url, password_hash, created_at 
     FROM users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw new AppError('Email o contraseña incorrectos', 401);
  }

  const user = result.rows[0];

  // Si el usuario se registró con OAuth y no tiene password
  if (!user.password_hash) {
    throw new AppError('Esta cuenta usa login con Google/GitHub. Usá ese método para ingresar.', 401);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('Email o contraseña incorrectos', 401);
  }

  // Actualizar last_login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

// ============================================
// OAuth: encontrar o crear usuario
// ============================================

export async function findOrCreateOAuthUser({ provider, providerId, email, name, avatarUrl }) {
  // Primero buscar por OAuth provider + ID
  let result = await query(
    `SELECT id, email, name, avatar_url, created_at 
     FROM users 
     WHERE oauth_provider = $1 AND oauth_provider_id = $2`,
    [provider, providerId]
  );

  if (result.rows.length > 0) {
    // Usuario existente, actualizar last_login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [result.rows[0].id]);
    return { user: result.rows[0], isNew: false };
  }

  // Buscar por email (podría tener cuenta con password)
  result = await query('SELECT id, email, name FROM users WHERE email = $1', [email]);

  if (result.rows.length > 0) {
    // Vincular OAuth a cuenta existente
    const updated = await query(
      `UPDATE users 
       SET oauth_provider = $1, oauth_provider_id = $2, avatar_url = COALESCE(avatar_url, $3), last_login_at = NOW()
       WHERE id = $4
       RETURNING id, email, name, avatar_url, created_at`,
      [provider, providerId, avatarUrl, result.rows[0].id]
    );
    return { user: updated.rows[0], isNew: false };
  }

  // Crear usuario nuevo
  const newUser = await query(
    `INSERT INTO users (email, name, avatar_url, oauth_provider, oauth_provider_id, email_verified, last_login_at) 
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW()) 
     RETURNING id, email, name, avatar_url, created_at`,
    [email, name, avatarUrl, provider, providerId]
  );

  return { user: newUser.rows[0], isNew: true };
}

// ============================================
// Refresh Tokens
// ============================================

export async function createRefreshToken(userId, { userAgent, ipAddress }) {
  const token = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresIn = parseExpiresIn(config.jwt.refreshExpiresIn);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, userAgent, ipAddress, expiresAt]
  );

  // Limpiar tokens viejos del mismo usuario (mantener máximo 5 sesiones)
  await query(
    `DELETE FROM refresh_tokens 
     WHERE user_id = $1 
     AND id NOT IN (
       SELECT id FROM refresh_tokens 
       WHERE user_id = $1 AND revoked_at IS NULL 
       ORDER BY created_at DESC LIMIT 5
     )`,
    [userId]
  );

  return token;
}

export async function verifyRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const result = await query(
    `SELECT rt.*, u.id as uid, u.email, u.name, u.avatar_url
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 
     AND rt.revoked_at IS NULL 
     AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw new AppError('Refresh token inválido o expirado', 401);
  }

  return result.rows[0];
}

export async function revokeRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );
}

export async function revokeAllUserTokens(userId) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

// ============================================
// Obtener perfil del usuario con org y plan
// ============================================

export async function getUserProfile(userId) {
  const result = await query(
    `SELECT 
      u.id, u.email, u.name, u.avatar_url, u.email_verified, u.created_at,
      o.id as org_id, o.name as org_name, o.slug as org_slug, o.industry,
      s.plan, s.status as plan_status, s.trial_ends_at,
      s.max_channels, s.max_conversations_per_month
     FROM users u
     LEFT JOIN organizations o ON o.owner_id = u.id
     LEFT JOIN subscriptions s ON s.organization_id = o.id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Usuario no encontrado', 404);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
    organization: row.org_id ? {
      id: row.org_id,
      name: row.org_name,
      slug: row.org_slug,
      industry: row.industry,
    } : null,
    subscription: row.plan ? {
      plan: row.plan,
      status: row.plan_status,
      trialEndsAt: row.trial_ends_at,
      maxChannels: row.max_channels,
      maxConversationsPerMonth: row.max_conversations_per_month,
    } : null,
  };
}

// ============================================
// Error custom para la app
// ============================================

export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}
