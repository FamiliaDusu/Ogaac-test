-- ============================================
-- OGAAC - Schema de Base de Datos
-- PostgreSQL 15 - Enero 2026
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- SEDES
CREATE TABLE IF NOT EXISTS sedes (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    direccion VARCHAR(200),
    activa BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sedes (codigo, nombre, direccion) VALUES
    ('suipacha', 'Suipacha', 'Suipacha 463, CABA'),
    ('tacuari', 'Tacuari (ex-CG)', 'Tacuari 138, CABA'),
    ('libertad', 'Libertad', 'Libertad 1042, CABA'),
    ('yrigoyen', 'Yrigoyen', 'Hipólito Yrigoyen 950, CABA'),
    ('gesell', 'Cámara Gesell Talcahuano', 'Talcahuano 550, CABA'),
    ('corrientes', 'Corrientes', 'Corrientes 1515, CABA'),
    ('balbin', 'Balbín', 'Ricardo Balbín 1750, CABA')
ON CONFLICT (codigo) DO NOTHING;

-- SALAS
CREATE TABLE IF NOT EXISTS salas (
    id SERIAL PRIMARY KEY,
    sede_id INTEGER REFERENCES sedes(id),
    codigo VARCHAR(50) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    piso VARCHAR(50),
    dvr_hostname VARCHAR(100),
    dvr_ip INET,
    obs_websocket_port INTEGER DEFAULT 4455,
    hls_stream_url VARCHAR(255),
    activa BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sede_id, codigo)
);

-- AUDIENCIAS
CREATE TABLE IF NOT EXISTS audiencias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sala_id INTEGER REFERENCES salas(id),
    fecha DATE NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    fuero VARCHAR(100),
    juzgado VARCHAR(200),
    expediente VARCHAR(100),
    caratula TEXT,
    tipo_audiencia VARCHAR(100),
    cantidad_imputados INTEGER DEFAULT 0,
    estado VARCHAR(50) DEFAULT 'programada',
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_audiencias_fecha ON audiencias(fecha);
CREATE INDEX IF NOT EXISTS idx_audiencias_sala ON audiencias(sala_id);

-- GRABACIONES
CREATE TABLE IF NOT EXISTS grabaciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audiencia_id UUID REFERENCES audiencias(id),
    sala_id INTEGER REFERENCES salas(id),
    fecha_inicio TIMESTAMP WITH TIME ZONE,
    fecha_fin TIMESTAMP WITH TIME ZONE,
    duracion_segundos INTEGER,
    archivo_path VARCHAR(500),
    archivo_size_bytes BIGINT,
    hash_sha256 VARCHAR(64),
    hash_verificado BOOLEAN DEFAULT false,
    estado VARCHAR(50) DEFAULT 'grabando',
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grabaciones_hash ON grabaciones(hash_sha256);

-- ESTADO SALAS (heartbeat)
CREATE TABLE IF NOT EXISTS estado_salas (
    sala_id INTEGER PRIMARY KEY REFERENCES salas(id),
    obs_conectado BOOLEAN DEFAULT false,
    streaming_activo BOOLEAN DEFAULT false,
    grabando BOOLEAN DEFAULT false,
    ultimo_heartbeat TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Permisos
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ogaac_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ogaac_app;

SELECT 'Schema OGAAC creado' AS resultado;
