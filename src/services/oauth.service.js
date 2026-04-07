// ============================================
// BotFlow.ai — OAuth Helpers (Google + GitHub)
// ============================================

import { config } from '../config.js';

// ============================================
// Google OAuth
// ============================================

export function getGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.oauth.google.clientId,
    redirect_uri: config.oauth.google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state: state || '',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function getGoogleUser(code) {
  // Intercambiar code por tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.oauth.google.clientId,
      client_secret: config.oauth.google.clientSecret,
      redirect_uri: config.oauth.google.callbackUrl,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error('Error al obtener token de Google');
  }

  const tokens = await tokenRes.json();

  // Obtener info del usuario
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error('Error al obtener usuario de Google');
  }

  const profile = await userRes.json();

  return {
    provider: 'google',
    providerId: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
  };
}

// ============================================
// GitHub OAuth
// ============================================

export function getGitHubAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.oauth.github.clientId,
    redirect_uri: config.oauth.github.callbackUrl,
    scope: 'read:user user:email',
    state: state || '',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function getGitHubUser(code) {
  // Intercambiar code por token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.oauth.github.clientId,
      client_secret: config.oauth.github.clientSecret,
      code,
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.error) {
    throw new Error(`Error de GitHub: ${tokens.error_description}`);
  }

  // Obtener perfil
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
    },
  });

  const profile = await userRes.json();

  // Obtener email (puede ser privado)
  let email = profile.email;
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
    });
    const emails = await emailRes.json();
    const primary = emails.find(e => e.primary) || emails[0];
    email = primary?.email;
  }

  return {
    provider: 'github',
    providerId: String(profile.id),
    email,
    name: profile.name || profile.login,
    avatarUrl: profile.avatar_url,
  };
}
