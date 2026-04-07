# BotFlow.ai — Backend API

API backend de BotFlow.ai construida con Fastify + PostgreSQL + pgvector.

## Stack

- **Runtime:** Node.js 20 + Fastify 4
- **DB:** PostgreSQL (Supabase) + pgvector
- **Auth:** JWT + OAuth (Google, GitHub)
- **IA:** Claude API (Haiku) + Voyage AI (embeddings)

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno
cp .env.example .env
# Editar .env con tus credentials

# 3. Ejecutar migraciones
npm run migrate

# 4. Seedear datos de demo (opcional)
npm run seed

# 5. Iniciar servidor
npm run dev
```

## Deploy

Ver `DEPLOY_GUIDE.md` en el directorio `botflow-deploy`.

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/auth/register | Registro |
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh token |
| GET | /api/auth/me | Perfil del usuario |
| GET/POST | /api/auth/google | OAuth Google |
| GET/POST | /api/auth/github | OAuth GitHub |
| POST | /api/organizations | Crear organización |
| GET | /api/bots | Listar bots |
| POST | /api/bots | Crear bot |
| PUT | /api/bots/:id | Actualizar bot |
| GET | /api/bots/:id/knowledge | Listar knowledge |
| POST | /api/bots/:id/knowledge | Crear fuente |
| GET | /api/bots/:id/quick-replies | Listar respuestas |
| POST | /api/bots/:id/quick-replies | Crear respuesta |
| GET | /api/bots/:id/channels | Listar canales |
| GET | /api/bots/:id/analytics | Stats del dashboard |
| POST | /api/gateway/widget/:botId/message | Enviar mensaje al bot |
| GET | /api/gateway/widget/:botId/config | Config pública del bot |
| POST | /api/gateway/whatsapp/webhook | Webhook de Twilio |
| POST | /api/gateway/telegram/webhook/:token | Webhook de Telegram |
| GET | /api/health | Health check |
