#!/bin/bash
# ============================================
# BotFlow.ai — Setup de Supabase
# Ejecutar después de crear el proyecto en Supabase
# ============================================

set -e

echo "🚀 BotFlow.ai — Setup de base de datos"
echo "========================================="
echo ""

# Verificar que la DATABASE_URL esté configurada
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL no está configurada"
  echo ""
  echo "Pasos para obtenerla:"
  echo "  1. Andá a https://supabase.com/dashboard"
  echo "  2. Creá un nuevo proyecto llamado 'botflow'"
  echo "  3. Andá a Settings → Database → Connection string → URI"
  echo "  4. Copiá la URI y ejecutá:"
  echo ""
  echo "  export DATABASE_URL='postgresql://postgres:TU_PASSWORD@db.XXXXX.supabase.co:5432/postgres'"
  echo "  bash scripts/setup-db.sh"
  echo ""
  exit 1
fi

echo "📦 Conectando a Supabase..."
echo ""

# Verificar conexión
psql "$DATABASE_URL" -c "SELECT 'Conexión exitosa' as status;" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "❌ No se pudo conectar a la base de datos"
  echo "Verificá que la DATABASE_URL sea correcta"
  exit 1
fi

echo ""
echo "📋 Ejecutando migraciones..."

# Migración 001: Schema inicial
echo "  ▶️  001_initial_schema.sql..."
psql "$DATABASE_URL" -f src/db/migrations/001_initial_schema.sql 2>&1 | tail -5
echo "  ✅ Schema inicial creado"

# Migración 002: Vector dimensions
echo "  ▶️  002_vector_dimensions.sql..."
psql "$DATABASE_URL" -f src/db/migrations/002_vector_dimensions.sql 2>&1 | tail -5
echo "  ✅ Vector dimensions configuradas"

echo ""
echo "🌱 ¿Querés seedear datos de demo? (Café Aroma) [y/N]"
read -r SEED_RESPONSE

if [[ "$SEED_RESPONSE" =~ ^[Yy]$ ]]; then
  echo "  Sembrando datos de demo..."
  node src/db/seed.js
  echo "  ✅ Datos de demo creados"
  echo "     Email: demo@botflow.ai"
  echo "     Password: demo1234"
fi

echo ""
echo "✅ Base de datos configurada correctamente!"
echo ""
echo "Próximo paso: deployar el backend en Railway"
echo "  → railway login && railway init && railway up"
