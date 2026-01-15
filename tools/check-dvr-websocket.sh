#!/bin/bash
# ============================================
# OGAAC - Script de Detección OBS WebSocket
# Verifica conectividad con DVRs Cicero
# ============================================

OBS_WS_PORT=4455
TIMEOUT=3

# DVRs con IPs reales y mapeo de salas
declare -A DVRS=(
  ["dvr-cicero-54"]="10.15.201.7|Libertad SUM"
  ["dvr-cicero-55"]="10.72.201.5|Corrientes"
  ["dvr-cicero-57"]="10.7.203.55|Tacuari Sala 3"
  ["dvr-cicero-58"]="10.64.202.55|Suipacha Sala 8"
  ["dvr-cicero-59"]="10.64.204.61|Suipacha Sala 9"
  ["dvr-cicero-60"]="10.64.207.55|Suipacha Sala 1"
  ["dvr-cicero-61"]="10.64.205.58|Suipacha Sala 3"
  ["dvr-cicero-62"]="10.75.201.55|Gesell CG"
  ["dvr-cicero-63"]="10.64.203.55|Suipacha Sala 2"
  ["dvr-cicero-64"]="10.7.206.55|Tacuari Sala 6"
  ["dvr-cicero-69"]="10.64.106.79|Yrigoyen Sala 2"
  ["dvr-cicero-72"]="10.64.201.55|Suipacha Sala 4"
  ["dvr-cicero-73"]="10.46.201.55|Yrigoyen Sala 1"
  ["dvr-cicero-74"]="10.7.209.55|Tacuari Sala 9"
  ["dvr-cicero-76"]="10.7.204.55|Tacuari Sala 4-5"
  ["dvr-cicero-77"]="10.64.206.55|Suipacha Sala 10"
  ["dvr-cicero-78"]="10.7.208.55|Tacuari Sala 8"
)

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "============================================"
echo "OGAAC - Verificación de OBS WebSocket"
echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

TOTAL=0; ONLINE=0; OFFLINE=0; WS_OK=0

printf "%-18s %-16s %-20s %-8s %-12s\n" "HOSTNAME" "IP" "SALA" "PING" "WEBSOCKET"
echo "--------------------------------------------------------------------------------"

for hostname in $(echo "${!DVRS[@]}" | tr ' ' '\n' | sort); do
  IFS='|' read -r ip sala <<< "${DVRS[$hostname]}"
  TOTAL=$((TOTAL + 1))
  
  if ping -c 1 -W $TIMEOUT "$ip" &> /dev/null; then
    PING_STATUS="${GREEN}OK${NC}"
    ONLINE=$((ONLINE + 1))
    
    if timeout $TIMEOUT bash -c "echo > /dev/tcp/$ip/$OBS_WS_PORT" 2>/dev/null; then
      WS_STATUS="${GREEN}ACTIVO${NC}"
      WS_OK=$((WS_OK + 1))
    else
      WS_STATUS="${YELLOW}CERRADO${NC}"
    fi
  else
    PING_STATUS="${RED}OFFLINE${NC}"
    WS_STATUS="${RED}N/A${NC}"
    OFFLINE=$((OFFLINE + 1))
  fi
  
  printf "%-18s %-16s %-20s " "$hostname" "$ip" "$sala"
  echo -e "$PING_STATUS\t$WS_STATUS"
done

echo ""
echo "============================================"
echo "RESUMEN"
echo "============================================"
echo "Total DVRs:       $TOTAL"
echo -e "Online (ping):    ${GREEN}$ONLINE${NC}"
echo -e "Offline:          ${RED}$OFFLINE${NC}"
echo -e "WebSocket OK:     ${GREEN}$WS_OK${NC}"
echo -e "WebSocket Falta:  ${YELLOW}$((ONLINE - WS_OK))${NC}"
echo ""
