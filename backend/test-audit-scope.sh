#!/bin/bash
# test-audit-scope.sh - Script de pruebas para Auditoría y Scope
# Ejecutar desde ogaac-backend/

set -e

echo "════════════════════════════════════════════════════════════"
echo "TEST OGAAC: Auditoría + Scope"
echo "════════════════════════════════════════════════════════════"
echo ""

BASE_URL="http://localhost:8081"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================
# 1. Login como admin
# ============================================
echo -e "${YELLOW}[1/7] Login como admin...${NC}"
curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"sdupero","password":"ogaac2025"}' \
  > /tmp/admin_token.json

ADMIN_TOKEN=$(jq -r '.token' /tmp/admin_token.json 2>/dev/null)

if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" == "null" ]; then
  echo -e "${RED}✗ Error: No se pudo obtener token de admin${NC}"
  echo "Respuesta:"
  cat /tmp/admin_token.json
  exit 1
fi

echo -e "${GREEN}✓ Admin token OK${NC}"
echo ""

# ============================================
# 2. Crear usuario de prueba (genera audit)
# ============================================
echo -e "${YELLOW}[2/7] Crear usuario testaudit (genera evento audit)...${NC}"
curl -s -X POST "$BASE_URL/api/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testaudit_'$(date +%s)'",
    "password": "test123",
    "role": "viewer",
    "note": "Usuario de prueba audit"
  }' > /tmp/create_user.json

if grep -q '"ok":true' /tmp/create_user.json; then
  echo -e "${GREEN}✓ Usuario creado (audit registrado)${NC}"
else
  echo -e "${RED}✗ Error al crear usuario${NC}"
  cat /tmp/create_user.json
fi
echo ""

# ============================================
# 3. Leer auditoría de hoy
# ============================================
echo -e "${YELLOW}[3/7] Leer auditoría de hoy...${NC}"
TODAY=$(date +%Y-%m-%d)
curl -s "$BASE_URL/api/admin/audit?date=$TODAY" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > /tmp/audit_today.json

COUNT=$(jq -r '.count' /tmp/audit_today.json 2>/dev/null)
echo -e "${GREEN}✓ Eventos de hoy: $COUNT${NC}"
echo "  Últimos 3 eventos:"
jq -r '.events[0:3] | .[] | "  - [\(.ts)] \(.user) \(.method) \(.path) (\(.status))"' /tmp/audit_today.json 2>/dev/null | head -3
echo ""

# ============================================
# 4. Probar filtros de auditoría
# ============================================
echo -e "${YELLOW}[4/7] Probar filtros de auditoría...${NC}"

# Filtro por user
curl -s "$BASE_URL/api/admin/audit?user=sdupero&limit=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > /tmp/audit_user.json
USER_COUNT=$(jq -r '.count' /tmp/audit_user.json 2>/dev/null)
echo -e "${GREEN}✓ Filtro user=sdupero: $USER_COUNT eventos${NC}"

# Filtro por action
curl -s "$BASE_URL/api/admin/audit?action=create_user&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > /tmp/audit_action.json
ACTION_COUNT=$(jq -r '.count' /tmp/audit_action.json 2>/dev/null)
echo -e "${GREEN}✓ Filtro action=create_user: $ACTION_COUNT eventos${NC}"

# Filtro por contains
curl -s "$BASE_URL/api/admin/audit?contains=/admin/users&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > /tmp/audit_contains.json
CONTAINS_COUNT=$(jq -r '.count' /tmp/audit_contains.json 2>/dev/null)
echo -e "${GREEN}✓ Filtro contains=/admin/users: $CONTAINS_COUNT eventos${NC}"
echo ""

# ============================================
# 5. Crear usuario con scope limitado
# ============================================
echo -e "${YELLOW}[5/7] Crear usuario con scope limitado...${NC}"
curl -s -X POST "$BASE_URL/api/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator_scope_test",
    "password": "test123",
    "role": "operator",
    "scope": {
      "sedes": ["suipacha"],
      "salas": {"suipacha": ["sala01"]}
    }
  }' > /tmp/create_limited.json

if grep -q '"ok":true' /tmp/create_limited.json; then
  echo -e "${GREEN}✓ Usuario con scope creado${NC}"
else
  # Puede fallar si ya existe, intentar login directo
  echo -e "${YELLOW}! Usuario ya existe, continuando...${NC}"
fi

# Login como usuario limitado
curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"operator_scope_test","password":"test123"}' \
  > /tmp/limited_token.json

LIMITED_TOKEN=$(jq -r '.token' /tmp/limited_token.json 2>/dev/null)

if [ -z "$LIMITED_TOKEN" ] || [ "$LIMITED_TOKEN" == "null" ]; then
  echo -e "${RED}✗ Error: No se pudo obtener token de usuario limitado${NC}"
  cat /tmp/limited_token.json
  exit 1
fi

echo -e "${GREEN}✓ Token de usuario limitado OK${NC}"
echo ""

# ============================================
# 6. Verificar scope en /api/me
# ============================================
echo -e "${YELLOW}[6/7] Verificar scope en /api/me...${NC}"
curl -s "$BASE_URL/api/me" \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  > /tmp/me_limited.json

SCOPE=$(jq -r '.scope' /tmp/me_limited.json 2>/dev/null)
echo "  Scope del usuario limitado:"
jq '.scope' /tmp/me_limited.json 2>/dev/null
echo -e "${GREEN}✓ Scope obtenido${NC}"
echo ""

# ============================================
# 7. Validar 403 SCOPE_DENIED
# ============================================
echo -e "${YELLOW}[7/7] Validar 403 SCOPE_DENIED (acceso fuera de scope)...${NC}"

# Intentar acceder a sala fuera de scope
HTTP_CODE=$(curl -s -o /tmp/scope_denied.json -w "%{http_code}" \
  "$BASE_URL/api/obs/balbin/sala02/status" \
  -H "Authorization: Bearer $LIMITED_TOKEN")

if [ "$HTTP_CODE" == "403" ]; then
  CODE=$(jq -r '.code' /tmp/scope_denied.json 2>/dev/null)
  if [ "$CODE" == "SCOPE_DENIED" ]; then
    echo -e "${GREEN}✓ 403 SCOPE_DENIED correcto${NC}"
    echo "  Mensaje:"
    jq -r '.message' /tmp/scope_denied.json 2>/dev/null | sed 's/^/  /'
  else
    echo -e "${YELLOW}! 403 pero code != SCOPE_DENIED${NC}"
    jq '.' /tmp/scope_denied.json 2>/dev/null
  fi
else
  echo -e "${RED}✗ Esperaba 403, obtuvo $HTTP_CODE${NC}"
  cat /tmp/scope_denied.json
fi
echo ""

# ============================================
# Verificar config filtrado
# ============================================
echo -e "${YELLOW}[BONUS] Verificar /api/obs/config filtrado por scope...${NC}"

# Usuario limitado
curl -s "$BASE_URL/api/obs/config" \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  > /tmp/config_limited.json
LIMITED_COUNT=$(jq -r '.salas | length' /tmp/config_limited.json 2>/dev/null)
echo -e "${GREEN}✓ Usuario limitado ve: $LIMITED_COUNT sala(s)${NC}"

# Admin (ve todas)
curl -s "$BASE_URL/api/obs/config" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > /tmp/config_admin.json
ADMIN_COUNT=$(jq -r '.salas | length' /tmp/config_admin.json 2>/dev/null)
echo -e "${GREEN}✓ Admin ve: $ADMIN_COUNT sala(s)${NC}"
echo ""

# ============================================
# RESUMEN
# ============================================
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}✓ TESTS COMPLETADOS${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Archivos generados en /tmp/:"
echo "  - admin_token.json"
echo "  - limited_token.json"
echo "  - audit_*.json"
echo "  - config_*.json"
echo ""
echo "Revisar auditoría completa:"
echo "  curl '$BASE_URL/api/admin/audit?date=$TODAY&limit=50' \\"
echo "    -H 'Authorization: Bearer $ADMIN_TOKEN' | jq"
echo ""
