#!/bin/bash

# Plantilla base
TEMPLATE="juzgado01.html"

if [ ! -f "$TEMPLATE" ]; then
  echo "No encuentro $TEMPLATE en la carpeta actual."
  exit 1
fi

for N in $(seq 2 31); do
  NUM="$N"
  NUM_PAD=$(printf "%02d" "$N")
  DEST="juzgado${NUM_PAD}.html"

  echo "Generando $DEST..."

  sed \
    -e "s/Juzgado N° 1 Penal, Contravencional y de Faltas/Juzgado N° ${NUM} Penal, Contravencional y de Faltas/g" \
    -e "s/Juzgado01/Juzgado${NUM_PAD}/g" \
    -e "s/juzgado01.html/juzgado${NUM_PAD}.html/g" \
    -e "s/\/api\/juzgado01/\/api\/juzgado${NUM_PAD}/g" \
    > "$DEST" < "$TEMPLATE"
done

echo "Listo. Generados juzgado02.html a juzgado31.html."
