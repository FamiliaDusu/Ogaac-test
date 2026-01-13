#!/usr/bin/env bash
# Quick sanity check for padded vs canonical sala paths
set -euo pipefail

BASE_URL=${BASE_URL:-"https://127.0.0.1:8443"}
SEDE=${1:-suipacha}
shift || true
SALAS=()
if [ "$#" -gt 0 ]; then
  SALAS=("$@")
else
  SALAS=(3 4 8 10)
fi

printf "Checking sede=%s against %s\n" "$SEDE" "$BASE_URL"

head_code() {
  local url="$1"
  curl -sk -o /dev/null -w "%{http_code}" -I "$url"
}

for raw in "${SALAS[@]}"; do
  # Normalize to numeric portion
  if [[ "$raw" =~ ^sala?([0-9]+)$ ]]; then
    num=${BASH_REMATCH[1]}
  else
    num=$raw
  fi

  canon="sala$((10#$num))"
  padded=$canon
  if ((10#$num < 10)); then
    padded=$(printf "sala%02d" "$((10#$num))")
  fi

  canon_url="$BASE_URL/hls/$SEDE/$canon/stream.m3u8"
  padded_url="$BASE_URL/hls/$SEDE/$padded/stream.m3u8"

  canon_code=$(head_code "$canon_url")
  padded_code=$(head_code "$padded_url")

  printf "%-12s canon:%3s (%s)  padded:%3s (%s)\n" "$canon" "$canon_code" "$canon_url" "$padded_code" "$padded_url"
done
