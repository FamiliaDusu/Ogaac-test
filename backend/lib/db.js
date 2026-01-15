/**
 * OGAAC - Módulo de conexión a PostgreSQL
 * Proporciona pool de conexiones y funciones de consulta
 */

const { Pool } = require('pg');

// Configuración de conexión
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'ogaac',
    user: process.env.DB_USER || 'ogaac_app',
    password: process.env.DB_PASSWORD || 'Ogaac2026Secure',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Cache para salas (TTL 60 segundos)
let salasCache = null;
let salasCacheTime = 0;
const CACHE_TTL = 60000;

/**
 * Ejecutar una query genérica
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.warn(`[DB] Query lenta (${duration}ms): ${text.substring(0, 50)}...`);
        }
        return result;
    } catch (err) {
        console.error('[DB] Error en query:', err.message);
        throw err;
    }
}

/**
 * Obtener todas las sedes activas
 */
async function getSedes() {
    const result = await query(`
    SELECT id, codigo, nombre, direccion, activa
    FROM sedes
    WHERE activa = true
    ORDER BY nombre
  `);
    return result.rows;
}

/**
 * Obtener todas las salas con info de sede
 */
async function getSalas() {
    const now = Date.now();
    if (salasCache && (now - salasCacheTime) < CACHE_TTL) {
        return salasCache;
    }

    const result = await query(`
    SELECT 
      s.id,
      se.codigo AS sede,
      s.codigo AS sala,
      s.nombre AS sala_nombre,
      s.dvr_hostname,
      HOST(s.dvr_ip) AS dvr_ip,
      s.obs_websocket_port,
      s.activa
    FROM salas s
    JOIN sedes se ON s.sede_id = se.id
    WHERE s.activa = true
    ORDER BY se.codigo, s.codigo
  `);

    salasCache = result.rows;
    salasCacheTime = now;
    return result.rows;
}

/**
 * Obtener configuración de salas en formato compatible con salas.json
 * Para retrocompatibilidad con el código existente
 */
async function getSalasConfig() {
    const salas = await getSalas();
    const config = {};

    for (const sala of salas) {
        if (!config[sala.sede]) {
            config[sala.sede] = {};
        }

        const wsUrl = sala.dvr_ip
            ? `ws://${sala.dvr_ip}:${sala.obs_websocket_port || 4455}`
            : null;

        config[sala.sede][sala.sala] = {
            ws: wsUrl,
            enabled: !!wsUrl,
            needsSecrets: true,
            dvr_hostname: sala.dvr_hostname,
            dvr_ip: sala.dvr_ip
        };
    }

    return config;
}

/**
 * Obtener lista de salas en formato array (para /api/obs/config)
 */
async function getSalasArray() {
    const salas = await getSalas();
    return salas.map(s => ({
        sede: s.sede,
        sala: s.sala,
        ws: s.dvr_ip ? `ws://${s.dvr_ip}:${s.obs_websocket_port || 4455}` : null,
        enabled: !!s.dvr_ip,
        dvr_hostname: s.dvr_hostname
    }));
}

/**
 * Obtener configuración de una sala específica
 */
async function getSalaConfig(sede, sala) {
    const result = await query(`
    SELECT 
      s.id,
      se.codigo AS sede,
      s.codigo AS sala,
      HOST(s.dvr_ip) AS dvr_ip,
      s.obs_websocket_port,
      s.activa
    FROM salas s
    JOIN sedes se ON s.sede_id = se.id
    WHERE se.codigo = $1 AND s.codigo = $2 AND s.activa = true
  `, [sede, sala]);

    if (result.rows.length === 0) return null;

    const s = result.rows[0];
    return {
        ws: s.dvr_ip ? `ws://${s.dvr_ip}:${s.obs_websocket_port || 4455}` : null,
        enabled: !!s.dvr_ip,
        needsSecrets: true
    };
}

/**
 * Invalidar cache (usar después de updates)
 */
function invalidateCache() {
    salasCache = null;
    salasCacheTime = 0;
}

/**
 * Cerrar pool de conexiones (cleanup)
 */
async function close() {
    await pool.end();
}

/**
 * Test de conexión
 */
async function testConnection() {
    try {
        const result = await query('SELECT NOW() as now, current_database() as db');
        console.log('[DB] Conexión exitosa:', result.rows[0]);
        return true;
    } catch (err) {
        console.error('[DB] Error de conexión:', err.message);
        return false;
    }
}

module.exports = {
    query,
    getSedes,
    getSalas,
    getSalasConfig,
    getSalasArray,
    getSalaConfig,
    invalidateCache,
    close,
    testConnection,
    pool
};
