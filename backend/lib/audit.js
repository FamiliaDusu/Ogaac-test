/**
 * audit.js - Sistema de auditoría de acciones OGAAC
 *
 * Registra todas las acciones relevantes en JSONL:
 * ogaac-backend/logs/audit-YYYY-MM-DD.jsonl
 *
 * Campos por evento:
 * - ts (ISO 8601)
 * - user, role
 * - method, path, status
 * - ip, userAgent
 * - durationMs
 * - meta (opcional: sede, sala, targetUser, action)
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");

const LOGS_DIR = path.join(__dirname, "../logs");
const MAX_BYTES = 50 * 1024 * 1024; // 50MB por archivo
const MAX_SUFFIX = 20; // Máximo de archivos _2, _3, ..., _20

// Claves sensibles a redactar (case-insensitive)
const SENSITIVE_KEYS = [
  'password', 'pass', 'pwd', 'token', 'authorization', 'auth',
  'secret', 'cookie', 'set-cookie', 'passwordhash'
];

/**
 * Scrubber de datos sensibles
 * Reemplaza valores de claves sensibles por [REDACTED]
 * Maneja objetos anidados y arrays, evita loops circulares
 *
 * @param {*} obj - Objeto a limpiar
 * @param {Set} visited - Set de objetos visitados (evita loops)
 * @returns {*} - Copia limpia
 */
function scrubSensitive(obj, visited = new WeakSet()) {
  // Null/undefined/primitivos → retornar tal cual
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Detectar circular
  if (visited.has(obj)) return '[CIRCULAR]';
  visited.add(obj);

  try {
    // Array
    if (Array.isArray(obj)) {
      return obj.map(item => scrubSensitive(item, visited));
    }

    // Object
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = String(key).toLowerCase();

      // Verificar si es clave sensible
      const isSensitive = SENSITIVE_KEYS.some(k => keyLower.includes(k));

      if (isSensitive) {
        cleaned[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        // Recursar en objetos/arrays anidados
        cleaned[key] = scrubSensitive(value, visited);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  } catch (err) {
    // Fail-safe: si falla, retornar objeto vacío
    console.error('[audit] Error en scrubSensitive:', err);
    return {};
  }
}

/**
 * Asegurar que existe la carpeta logs/
 */
async function ensureLogsDir() {
  try {
    await fsp.mkdir(LOGS_DIR, { recursive: true });
  } catch (err) {
    console.error("[audit] Error creando logs/:", err);
  }
}

/**
 * Generar nombre de archivo para una fecha (con sufijo opcional)
 * Formato: audit-YYYY-MM-DD.jsonl o audit-YYYY-MM-DD_N.jsonl
 * @param {string} date - Fecha YYYY-MM-DD (opcional, default: hoy)
 * @param {number} suffix - Sufijo numérico (opcional)
 */
function getAuditFilePath(date, suffix) {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const baseName = `audit-${targetDate}`;
  const fileName = suffix ? `${baseName}_${suffix}.jsonl` : `${baseName}.jsonl`;
  return path.join(LOGS_DIR, fileName);
}

/**
 * Obtener el archivo de audit activo para escritura (con rotación por tamaño)
 * Retorna el path del archivo donde se debe escribir
 */
async function getActiveAuditFilePath() {
  const today = new Date().toISOString().split("T")[0];

  // Intentar archivo principal primero
  let filePath = getAuditFilePath(today);

  try {
    const stats = await fsp.stat(filePath);

    // Si no excede MAX_BYTES, usar este
    if (stats.size < MAX_BYTES) {
      return filePath;
    }

    // Si excede, buscar siguiente sufijo disponible
    for (let i = 2; i <= MAX_SUFFIX; i++) {
      filePath = getAuditFilePath(today, i);

      try {
        const suffixStats = await fsp.stat(filePath);
        if (suffixStats.size < MAX_BYTES) {
          return filePath;
        }
      } catch (err) {
        // Archivo no existe, usar este
        if (err.code === 'ENOENT') {
          return filePath;
        }
      }
    }

    // Si llegamos al MAX_SUFFIX, warning y usar el último
    console.warn(`[audit] Alcanzado MAX_SUFFIX=${MAX_SUFFIX} para ${today}, usando último archivo`);
    return getAuditFilePath(today, MAX_SUFFIX);

  } catch (err) {
    // Archivo principal no existe, usar ese
    if (err.code === 'ENOENT') {
      return filePath;
    }

    // Otro error, fail-open: usar archivo principal
    console.error("[audit] Error en stat, usando archivo principal:", err);
    return filePath;
  }
}

/**
 * Registrar evento de auditoría
 *
 * @param {Object} req - Request de Node.js
 * @param {Object} res - Response de Node.js
 * @param {Object} meta - Metadata adicional (sede, sala, targetUser, action, etc.)
 *
 * IMPORTANTE:
 * - Se ejecuta post-response (no bloquea)
 * - Si falla, NO rompe el request
 * - NO loguea passwords ni JWT completo
 */
async function auditLog(req, res, meta = {}) {
  try {
    // Solo auditar si hay usuario autenticado
    if (!req._auditUser) {
      return; // No hay contexto de usuario (no llamó requireAuth exitosamente)
    }

    // HARDENING: Excluir /api/admin/audit para evitar auto-llenado
    const reqUrl = req.url || "";
    if (reqUrl.startsWith("/api/admin/audit")) {
      return; // No auditar consultas al log de auditoría
    }

    // HARDENING: Scrubber de datos sensibles en meta
    const scrubbedMeta = scrubSensitive(meta);

    const event = {
      ts: new Date().toISOString(),
      user: req._auditUser.username || "unknown",
      role: req._auditUser.role || null,
      method: req.method,
      path: reqUrl.split("?")[0], // Sin query params
      status: res.statusCode,
      ip: req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.connection.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
      durationMs: req._startTime ? Date.now() - req._startTime : null,
      meta: scrubbedMeta || null,
    };

    // Asegurar que existe logs/
    await ensureLogsDir();

    // Escribir línea JSONL (con rotación por tamaño)
    const logLine = JSON.stringify(event) + "\n";
    const filePath = await getActiveAuditFilePath();

    await fsp.appendFile(filePath, logLine, "utf-8");

    console.log(`[audit] ${event.user} ${event.method} ${event.path} ${event.status}`);
  } catch (err) {
    // NO romper el request si falla el log
    console.error("[audit] Error escribiendo log:", err);
  }
}

/**
 * Leer eventos de auditoría de una fecha específica
 * Lee archivo principal + sufijos (_2, _3, etc.) y combina resultados
 *
 * @param {string} date - Fecha en formato YYYY-MM-DD
 * @param {number} limit - Máximo de eventos a retornar (default: 200)
 * @param {Object} filters - Filtros opcionales: { user, action, contains }
 * @returns {Array} Array de eventos (más recientes primero)
 */
async function readAuditLog(date, limit = 200, filters = {}) {
  try {
    const allEvents = [];

    // Leer archivo principal + sufijos
    const filesToRead = [getAuditFilePath(date)];

    // Intentar leer sufijos _2, _3, ... hasta que no existan
    for (let i = 2; i <= MAX_SUFFIX; i++) {
      const suffixPath = getAuditFilePath(date, i);
      if (fs.existsSync(suffixPath)) {
        filesToRead.push(suffixPath);
      } else {
        break; // No existen más sufijos
      }
    }

    // Leer todos los archivos
    for (const filePath of filesToRead) {
      if (!fs.existsSync(filePath)) continue;

      const content = await fsp.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Parsear cada línea JSONL
      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      allEvents.push(...events);
    }

    // Aplicar filtros
    let filtered = allEvents;

    if (filters.user) {
      const userFilter = String(filters.user).toLowerCase();
      filtered = filtered.filter(e => (e.user || '').toLowerCase() === userFilter);
    }

    if (filters.action) {
      const actionFilter = String(filters.action).toLowerCase();
      filtered = filtered.filter(e => {
        const metaAction = (e.meta && e.meta.action) ? String(e.meta.action).toLowerCase() : '';
        return metaAction === actionFilter;
      });
    }

    if (filters.contains) {
      const containsFilter = String(filters.contains).toLowerCase();
      filtered = filtered.filter(e => {
        const path = (e.path || '').toLowerCase();
        return path.includes(containsFilter);
      });
    }

    // Retornar más recientes primero (reverse) y limitar
    return filtered.reverse().slice(0, limit);
  } catch (err) {
    console.error(`[audit] Error leyendo log ${date}:`, err);
    return [];
  }
}

/**
 * Listar archivos de auditoría disponibles
 * @returns {Array<string>} Array de fechas (YYYY-MM-DD)
 */
async function listAuditDates() {
  try {
    await ensureLogsDir();
    const files = await fsp.readdir(LOGS_DIR);

    return files
      .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .map((f) => f.replace("audit-", "").replace(".jsonl", ""))
      .sort()
      .reverse(); // Más reciente primero
  } catch (err) {
    console.error("[audit] Error listando fechas:", err);
    return [];
  }
}

module.exports = {
  auditLog,
  readAuditLog,
  listAuditDates,
  getAuditFilePath, // Helper exportado para uso en endpoint
};
