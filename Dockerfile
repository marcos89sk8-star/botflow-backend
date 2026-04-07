# ============================================
# BotFlow.ai — Backend Dockerfile
# Optimizado para Railway
# ============================================

FROM node:20-alpine AS base
WORKDIR /app

# Instalar dependencias
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Copiar código
COPY src/ ./src/

# Variables de entorno de Railway se inyectan en runtime
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "src/index.js"]
