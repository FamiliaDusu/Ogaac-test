#!/bin/bash
set -e

TEMPLATE="sala3.html"

if [ ! -f "$TEMPLATE" ]; then
  echo "No encuentro $TEMPLATE en $(pwd)"
  exit 1
fi

for N in 4 8 9 10; do
  DEST="sala${N}.html"
  echo "Generando $DEST..."

  sed \
    -e "s/Sala 3 · Suipacha · Streaming en vivo/Sala ${N} · Suipacha · Streaming en vivo/g" \
    -e "s/<h1>Sala 3 · Sede Suipacha<\/h1>/<h1>Sala ${N} · Sede Suipacha<\/h1>/g" \
    -e "s/la señal de la Sala 3,/la señal de la Sala ${N},/g" \
    -e "s/\/hls\/suipacha\/sala3\/stream.m3u8/\/hls\/suipacha\/sala${N}\/stream.m3u8/g" \
    -e "s/Reproduciendo Sala 3 Suipacha/Reproduciendo Sala ${N} Suipacha/g" \
    "$TEMPLATE" > "$DEST"
done

echo "? Listo: sala4.html sala8.html sala9.html sala10.html"
