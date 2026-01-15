#!/bin/bash
# ============================================
# OGAAC - Instalación de PostgreSQL 15
# Para Debian 12 (Bookworm)
# ============================================

set -e

echo "============================================"
echo "Instalando PostgreSQL 15 en Debian 12"
echo "============================================"

# 1. Actualizar repositorios
echo "[1/5] Actualizando repositorios..."
sudo apt update

# 2. Instalar PostgreSQL
echo "[2/5] Instalando PostgreSQL 15..."
sudo apt install -y postgresql postgresql-contrib

# 3. Iniciar servicio
echo "[3/5] Iniciando servicio..."
sudo systemctl enable postgresql
sudo systemctl start postgresql

# 4. Verificar instalación
echo "[4/5] Verificando instalación..."
sudo -u postgres psql -c "SELECT version();"

# 5. Crear base de datos OGAAC
echo "[5/5] Creando base de datos OGAAC..."
sudo -u postgres psql << 'EOSQL'
CREATE DATABASE ogaac;
CREATE USER ogaac_app WITH ENCRYPTED PASSWORD 'CAMBIAR_PASSWORD_SEGURO';
GRANT ALL PRIVILEGES ON DATABASE ogaac TO ogaac_app;
\c ogaac
GRANT ALL ON SCHEMA public TO ogaac_app;
EOSQL

echo ""
echo "============================================"
echo "PostgreSQL instalado exitosamente!"
echo "============================================"
echo ""
echo "Base de datos: ogaac"
echo "Usuario: ogaac_app"
echo "Password: CAMBIAR_PASSWORD_SEGURO (¡CAMBIAR!)"
echo ""
echo "Para conectar:"
echo "  psql -h localhost -U ogaac_app -d ogaac"
echo ""
