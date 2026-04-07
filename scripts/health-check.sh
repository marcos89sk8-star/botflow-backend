#!/bin/bash
# ============================================
# BotFlow.ai — Health Check post-deploy
# Verifica que todo esté andando
# ============================================

set -e

API_URL="${1:-https://api.botflow.ai}"
FRONTEND_URL="${2:-https://botflow.ai}"

echo "🔍 BotFlow.ai — Health Check"
echo "=============================="
echo ""

# Check backend
echo "1️⃣  Backend ($API_URL)..."
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/health" 2>/dev/null || echo "000")
if [ "$BACKEND_STATUS" = "200" ]; then
  HEALTH=$(curl -s "$API_URL/api/health")
  echo "   ✅ Backend OK ($BACKEND_STATUS)"
  echo "   $HEALTH"
else
  echo "   ❌ Backend FAIL (HTTP $BACKEND_STATUS)"
fi

echo ""

# Check DB via backend
echo "2️⃣  Base de datos..."
if echo "$HEALTH" | grep -q '"connected"'; then
  echo "   ✅ PostgreSQL conectado"
else
  echo "   ❌ PostgreSQL desconectado"
fi

echo ""

# Check ping
echo "3️⃣  Ping..."
PING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/ping" 2>/dev/null || echo "000")
if [ "$PING_STATUS" = "200" ]; then
  echo "   ✅ Ping OK"
else
  echo "   ❌ Ping FAIL"
fi

echo ""

# Check frontend
echo "4️⃣  Frontend ($FRONTEND_URL)..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo "   ✅ Frontend OK ($FRONTEND_STATUS)"
else
  echo "   ❌ Frontend FAIL (HTTP $FRONTEND_STATUS)"
fi

echo ""

# Check widget endpoint
echo "5️⃣  Widget endpoint..."
WIDGET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/api/widget" 2>/dev/null || echo "000")
if [ "$WIDGET_STATUS" = "200" ]; then
  echo "   ✅ Widget JS servido correctamente"
else
  echo "   ⚠️  Widget no disponible (HTTP $WIDGET_STATUS)"
fi

echo ""

# Check gateway (bot config endpoint)
echo "6️⃣  Gateway (widget config)..."
GATEWAY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/gateway/widget/bf_test/config" 2>/dev/null || echo "000")
if [ "$GATEWAY_STATUS" = "404" ]; then
  echo "   ✅ Gateway respondiendo (404 = bot no existe, pero la ruta anda)"
elif [ "$GATEWAY_STATUS" = "200" ]; then
  echo "   ✅ Gateway OK"
else
  echo "   ❌ Gateway FAIL (HTTP $GATEWAY_STATUS)"
fi

echo ""
echo "=============================="
echo "Health check completado"
