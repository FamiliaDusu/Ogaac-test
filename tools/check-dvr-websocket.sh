#!/bin/bash
# ============================================
# OGAAC - Script de Detección OBS WebSocket
# Verifica conectividad con DVRs Cicero
# ============================================

# Configuración
OBS_WS_PORT=4455
TIMEOUT=3

# Lista de DVRs con su mapeo
declare -A DVRS=(
  ["dvr-cicero-54"]="Libertad SUM"
  ["dvr-cicero-55"]="Corrientes"
  ["dvr-cicero-57"]="Tacuari Sala 3"
  ["dvr-cicero-58"]="Suipacha Sala 8"
  ["dvr-cicero-59"]="Suipacha Sala 9"
  ["dvr-cicero-60"]="Suipacha Sala 1"
  ["dvr-cicero-61"]="Suipacha Sala 3"
  ["dvr-cicero-62"]="Gesell CG"
  ["dvr-cicero-63"]="Suipacha Sala 2"
  ["dvr-cicero-64"]="Tacuari Sala 6"
  ["dvr-cicero-69"]="Yrigoyen Sala 2"
  ["dvr-cicero-72"]="Suipacha Sala 4"
  ["dvr-cicero-73"]="Yrigoyen Sala 1"
  ["dvr-cicero-74"]="Tacuari Sala 9"
  ["dvr-cicero-76"]="Tacuari Sala 4-5"
  ["dvr-cicero-77"]="Suipacha Sala 10"
  ["dvr-cicero-78"]="Tacuari Sala 8"
)

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "OGAAC - Verificación de OBS WebSocket"
echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# Contadores
TOTAL=0
ONLINE=0
OFFLINE=0
WS_OK=0

printf "%-20s %-20s %-10s %-15s\n" "HOSTNAME" "SALA" "PING" "WEBSOCKET"
echo "------------------------------------------------------------"

for hostname in "${!DVRS[@]}"; do
  sala="${DVRS[$hostname]}"
  TOTAL=$((TOTAL + 1))
  
  # Test ping
  if ping -c 1 -W $TIMEOUT "$hostname" &> /dev/null; then
    PING_STATUS="${GREEN}OK${NC}"
    ONLINE=$((ONLINE + 1))
    
    # Test WebSocket port
    if timeout $TIMEOUT bash -c "echo > /dev/tcp/$hostname/$OBS_WS_PORT" 2>/dev/null; then
      WS_STATUS="${GREEN}ACTIVO${NC}"
      WS_OK=$((WS_OK + 1))
    else
      WS_STATUS="${YELLOW}PUERTO CERRADO${NC}"
    fi
  else
    PING_STATUS="${RED}OFFLINE${NC}"
    WS_STATUS="${RED}N/A${NC}"
    OFFLINE=$((OFFLINE + 1))
  fi
  
  printf "%-20s %-20s " "$hostname" "$sala"
  echo -e "$PING_STATUS\t\t$WS_STATUS"
done

echo ""
echo "============================================"
echo "RESUMEN"
echo "============================================"
echo "Total DVRs:      $TOTAL"
echo -e "Online:          ${GREEN}$ONLINE${NC}"
echo -e "Offline:         ${RED}$OFFLINE${NC}"
echo -e "WebSocket OK:    ${GREEN}$WS_OK${NC}"
echo -e "WebSocket Falta: ${YELLOW}$((ONLINE - WS_OK))${NC}"
echo ""
