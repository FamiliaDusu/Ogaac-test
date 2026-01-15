const fs = require("fs");
const path = require("path");

const SALAS_PUBLIC_FILE = path.join(__dirname, "..", "config", "salas.json");
const SALAS_SECRETS_FILE = path.join(__dirname, "..", "config", "salas.secrets.json");

const SECRET_KEYWORDS = ["password", "pass", "secret", "token", "rtsp", "rtspurl"];

function readJsonSafe(filePath, options = {}) {
  const { traceId = null, optional = false } = options;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return { ok: true, data: {} };
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    if (optional && error && error.code === "ENOENT") {
      return { ok: true, data: {}, missing: true };
    }

    const code = error && error.code === "ENOENT" ? "CONFIG_NOT_FOUND" : "CONFIG_PARSE_ERROR";
    return {
      ok: false,
      error: {
        code,
        file: filePath,
        message: `No pude leer ${path.basename(filePath)}: ${error.message}`,
        traceId,
      },
    };
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) out[key] = deepClone(val);
  return out;
}

function mergeDeep(base = {}, extra = {}) {
  const result = deepClone(isPlainObject(base) ? base : {});
  const source = isPlainObject(extra) ? extra : {};

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }

  return result;
}

function resolveBoolean(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function sanitizePublicConfig(config = {}) {
  const safeClone = deepClone(config);

  function recurse(obj) {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i += 1) obj[i] = recurse(obj[i]);
      return obj;
    }
    if (!isPlainObject(obj)) return obj;

    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (SECRET_KEYWORDS.some((kw) => lower.includes(kw))) {
        delete obj[key];
        continue;
      }
      obj[key] = recurse(obj[key]);
    }
    return obj;
  }

  return recurse(safeClone);
}

function extractWsEndpoint(config = {}) {
  if (!config) return null;

  if (typeof config.ws === "string" && config.ws.trim()) return config.ws.trim();

  if (isPlainObject(config.obs)) {
    const obs = config.obs;
    if (typeof obs.ws === "string" && obs.ws.trim()) return obs.ws.trim();

    if (isPlainObject(obs.ws)) {
      if (typeof obs.ws.url === "string" && obs.ws.url.trim()) return obs.ws.url.trim();
      const host = obs.ws.host || obs.ws.ip;
      const port = obs.ws.port;
      if (host && port) return `ws://${host}:${port}`;
    }
  }

  return null;
}

function extractRtspUrl(config = {}) {
  if (!config) return null;
  if (typeof config.rtsp === "string" && config.rtsp.trim()) return config.rtsp.trim();
  if (isPlainObject(config.rtsp) && typeof config.rtsp.url === "string" && config.rtsp.url.trim()) {
    return config.rtsp.url.trim();
  }
  if (typeof config.rtspUrl === "string" && config.rtspUrl.trim()) return config.rtspUrl.trim();
  if (isPlainObject(config.stream) && typeof config.stream.rtsp === "string" && config.stream.rtsp.trim()) {
    return config.stream.rtsp.trim();
  }
  return null;
}

function buildSalasSnapshot(options = {}) {
  const traceId = options.traceId || null;
  const warnings = [];

  const publicRes = readJsonSafe(SALAS_PUBLIC_FILE, { traceId });
  if (!publicRes.ok) {
    return { ok: false, traceId, error: publicRes.error };
  }

  const secretsRes = readJsonSafe(SALAS_SECRETS_FILE, { traceId, optional: true });
  if (!secretsRes.ok) {
    return { ok: false, traceId, error: secretsRes.error };
  }

  const publicTree = isPlainObject(publicRes.data) ? publicRes.data : {};
  const secretsTree = isPlainObject(secretsRes.data) ? secretsRes.data : {};
  const mergedTree = {};
  const publicList = [];
  const fullList = [];
  const publicById = {};
  const fullById = {};
  const sedesSet = new Set();
  const seenIds = new Set();

  let totalSalas = 0;
  let withSecrets = 0;
  let missingSecrets = 0;

  for (const [sede, salasObjRaw] of Object.entries(publicTree)) {
    if (!isPlainObject(salasObjRaw)) continue;
    sedesSet.add(sede);
    if (!mergedTree[sede]) mergedTree[sede] = {};

    for (const [sala, cfgRaw] of Object.entries(salasObjRaw)) {
      if (!isPlainObject(cfgRaw)) continue;
      const id = `${sede}/${sala}`;
      seenIds.add(id);
      totalSalas += 1;

      const enabled = resolveBoolean(cfgRaw.enabled, true);
      const needsSecrets = resolveBoolean(cfgRaw.needsSecrets, true);
      const requiresSecrets = enabled !== false && needsSecrets !== false;

      const secretCfg = isPlainObject(secretsTree?.[sede]?.[sala]) ? secretsTree[sede][sala] : {};
      const merged = mergeDeep(cfgRaw, secretCfg);
      mergedTree[sede][sala] = merged;

      const hasSecrets = Object.keys(secretCfg).length > 0;
      if (hasSecrets) withSecrets += 1;
      else if (requiresSecrets) {
        missingSecrets += 1;
        warnings.push({ code: "missing-secrets", id, message: `No hay secretos para ${id}` });
      }

      const sanitized = sanitizePublicConfig(merged);
      const publicEntry = { id, sede, sala, hasSecrets, ...sanitized };
      const fullEntry = { id, sede, sala, hasSecrets, ...deepClone(merged) };

      publicList.push(publicEntry);
      fullList.push(fullEntry);
      publicById[id] = publicEntry;
      fullById[id] = merged;
    }
  }

  for (const [sede, salasObjRaw] of Object.entries(secretsTree)) {
    if (!isPlainObject(salasObjRaw)) continue;
    for (const sala of Object.keys(salasObjRaw)) {
      const id = `${sede}/${sala}`;
      if (!seenIds.has(id)) {
        warnings.push({ code: "secrets-extra", id, message: `Secreto sin config pública para ${id}` });
      }
    }
  }

  publicList.sort((a, b) => a.id.localeCompare(b.id));
  fullList.sort((a, b) => a.id.localeCompare(b.id));

  const duplicateObsWs = collectDuplicates(fullById, extractWsEndpoint, "duplicate-obs-ws", warnings);
  const duplicateRtsp = collectDuplicates(fullById, extractRtspUrl, "duplicate-rtsp", warnings);

  const counts = {
    totalSedes: sedesSet.size,
    totalSalas,
    withSecrets,
    missingSecrets,
    duplicateObsWs,
    duplicateRtsp,
  };

  return {
    ok: true,
    traceId,
    warnings,
    counts,
    publicTree,
    secretsTree,
    mergedTree,
    publicList,
    fullList,
    publicById,
    fullById,
  };
}

function collectDuplicates(fullById, extractor, code, warnings) {
  const map = new Map();
  for (const [id, cfg] of Object.entries(fullById)) {
    const value = extractor(cfg);
    if (!value) continue;
    const key = value.trim().toLowerCase();
    if (!map.has(key)) map.set(key, { raw: value.trim(), ids: [] });
    map.get(key).ids.push(id);
  }

  let duplicates = 0;
  for (const { raw, ids } of map.values()) {
    const uniques = Array.from(new Set(ids));
    if (uniques.length <= 1) continue;
    duplicates += 1;
    warnings.push({
      code,
      value: raw,
      ids: uniques,
      message: `Valor '${raw}' repetido en ${uniques.join(", ")}`,
    });
  }
  return duplicates;
}

module.exports = {
  SALAS_PUBLIC_FILE,
  SALAS_SECRETS_FILE,
  readJsonSafe,
  buildSalasSnapshot,
  extractWsEndpoint,
  extractRtspUrl,
};
