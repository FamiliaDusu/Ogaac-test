require("dotenv").config();

// -------------------------------------------------------------
// Backend OGAAC - versión segura y estable
// + OBS WebSocket Sala 10 (control completo)
// -------------------------------------------------------------
const http = require("http");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { buildSalasSnapshot } = require("./lib/salas-config");
const usersManager = require("./lib/users-manager");
const { auditLog, readAuditLog, listAuditDates } = require("./lib/audit");

// ✅ OBS WebSocket (Sala 10)
const OBSWebSocket = require("obs-websocket-js").default;

// -------------------------------------------------------------
// CONFIGURACIÓN
// -------------------------------------------------------------
// JWT Secret - Validación estricta (SECURITY FIX 2026-01-09)
const SECRET = process.env.OGAAC_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("FATAL: OGAAC_JWT_SECRET no definido o muy corto en .env (mínimo 32 chars)");
  console.error("Tip: Genera uno con node -e crypto.randomBytes(32).toString");
  process.exit(1);
}
console.log("[Security] JWT Secret cargado correctamente (" + SECRET.length + " caracteres)");

const OGAAC_USER = process.env.OGAAC_USER || "admin";
const OGAAC_PASS = process.env.OGAAC_PASS || "CHANGE_ME";
const OGAAC_USER_ROLE = process.env.OGAAC_USER_ROLE || "admin";
const VALID_USERS = {
  [OGAAC_USER]: {
    password: OGAAC_PASS,
    role: OGAAC_USER_ROLE,
  },
};


// Ruta base del share montado
const BASE_AUD =
  "/var/www/ogaac/audiencias/Proyecto_Ogaac/Penal, Contravencional y de Faltas";

// ✅ Config OBS Sala 10
const OBS_SALA10 = {
  url: process.env.OBS_SALA10_WS || "ws://127.0.0.1:4455",
  password: process.env.OBS_SALA10_PASSWORD || "",
};

// ------------------------------
// CONFIG SALAS (multi-sede/sala)
// ------------------------------

// ✅ Inputs de audio (DEBEN EXISTIR CON ESTOS NOMBRES EN OBS)
// (AJUSTADO A LOS INPUTS REALES QUE VISTE EN /inputs)
const AUDIO_INPUTS_SALA10 = {
  desktop: "webex 2",
  micjack: "Presnecial",
};

// ------------------------------
// AUDIENCIA (metadata) - Sala 10
// ------------------------------
const AUDIENCIA_STATE_DIR = "/var/www/ogaac-test/state";
const AUDIENCIA_SALA10_FILE = path.join(
  AUDIENCIA_STATE_DIR,
  "sala10_audiencia.json"
);

// Overlay texto en OBS (debe existir con este nombre exacto)
const OBS_OVERLAY_AUDIENCIA_INPUT = "OV_INFO_AUDIENCIA";

function nowIso() {
  return new Date().toISOString();
}

function safeText(x) {
  return String(x ?? "").trim();
}

function sanitizeOneLine(s) {
  return safeText(s).replace(/\s+/g, " ").replace(/\r?\n/g, " ").trim();
}

function sanitizeFilenamePart(s) {
  let out = sanitizeOneLine(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .trim();

  if (!out) out = "SIN_DATO";
  return out.slice(0, 120);
}

async function readAudienciaSala10() {
  try {
    const raw = await fsp.readFile(AUDIENCIA_SALA10_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      ok: true,
      data: {
        visibleBanner: true,
        visibleOverlay: true,
        updatedAt: null,
        fields: {},
      },
    };
  }
}

async function writeAudienciaSala10(payload) {
  await fsp.mkdir(AUDIENCIA_STATE_DIR, { recursive: true });
  await fsp.writeFile(
    AUDIENCIA_SALA10_FILE,
    JSON.stringify(payload, null, 2),
    "utf-8"
  );
  return true;
}

function buildAudienciaText(fields) {
  const fecha = safeText(fields.fecha);
  const juzgado = safeText(fields.juzgado);
  const sala = safeText(fields.sala);
  const expediente = safeText(fields.expediente);
  const caratula = safeText(fields.caratula);
  const imputados = safeText(fields.imputados);
  const tipo = safeText(fields.tipoProcedimiento);

  const l1 = [
    fecha && `Fecha: ${fecha}`,
    juzgado && `Juzgado: ${juzgado}`,
    sala && `Sala: ${sala}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const l2 = [expediente && `Expte: ${expediente}`, caratula && caratula]
    .filter(Boolean)
    .join(" · ");

  const l3 = [tipo && `Tipo: ${tipo}`, imputados && `Imputados: ${imputados}`]
    .filter(Boolean)
    .join(" · ");

  return [l1, l2, l3].filter(Boolean).join("\n");
}

// ✅ Carpeta para screenshots (servida por nginx en el test)
const SCREENSHOT_DIR = "/var/www/ogaac-test/html/web-socket-obs/capturas";
const SCREENSHOT_URL_BASE = "/web-socket-obs/capturas";

try {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
} catch (e) {
  console.warn("No pude crear SCREENSHOT_DIR:", e.message);
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function normalizeRemoteAddress(addr) {
  if (!addr) return "";
  if (addr.startsWith("::ffff:")) return addr.slice(7);
  return addr;
}

function isLocalRequest(req) {
  const remote = normalizeRemoteAddress((req && req.socket && req.socket.remoteAddress) || "");
  return remote === "127.0.0.1" || remote === "::1";
}

// -------------------------------------------------------------
// Record ops (idempotencia / concurrencia por sala)
// -------------------------------------------------------------
const __recordOps = new Map(); // key -> { state, ts, lastOutputPath, lastError }

function __recKey(sede, sala) {
  return `${sede}:${sala}`;
}

function __getRecOp(sede, sala) {
  const key = __recKey(sede, sala);
  let op = __recordOps.get(key);
  if (!op) {
    op = { state: "idle", ts: Date.now(), lastOutputPath: null, lastError: null };
    __recordOps.set(key, op);
  }
  return op;
}

function __setRecState(op, state, extra = {}) {
  op.state = state;
  op.ts = Date.now();
  if (Object.prototype.hasOwnProperty.call(extra, "lastOutputPath")) op.lastOutputPath = extra.lastOutputPath;
  if (Object.prototype.hasOwnProperty.call(extra, "lastError")) op.lastError = extra.lastError;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function requireAuth(req) {
  let token = "";

  // 1) Authorization: Bearer <token>
  const auth = String(req.headers["authorization"] || "");
  if (auth.startsWith("Bearer ")) token = auth.slice(7).trim();

  // 2) Cookie ogaac_token=<token>
  if (!token) {
    const cookieHeader = String(req.headers["cookie"] || "");
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").reduce((acc, part) => {
        const [k, ...rest] = part.trim().split("=");
        if (!k) return acc;
        acc[k] = rest.join("=");
        return acc;
      }, {});
      if (cookies.ogaac_token) token = String(cookies.ogaac_token).trim();
    }
  }

  if (!token) return null;

  try {
    const payload = jwt.verify(token, SECRET);

    // AUDITORÍA: Guardar contexto de usuario en req para audit.js
    req._auditUser = {
      username: payload.username,
      role: payload.role,
    };

    return payload;
  } catch (e) {
    // DEBUG temporal: ver por qué falla
    console.error("[AUTH] verify fail:", e.message, {
      hasAuth: !!req.headers["authorization"],
      hasCookie: !!req.headers["cookie"],
      tokenLen: token.length,
    });
    return null;
  }
}

// -------------------------------------------------------------
// SCOPE: Filtrar salas según permisos del usuario
// -------------------------------------------------------------
/**
 * Filtra una lista de salas según el scope del usuario
 * @param {Array} salas - Lista de salas (con campos sede y sala)
 * @param {Object|null} scope - Scope del usuario { sedes: [...], salas: { sede: [...] } }
 * @returns {Array} - Salas filtradas (todas si scope es null)
 */
function filterSalasByScope(salas, scope) {
  // null/undefined scope = acceso total (retrocompatibilidad)
  if (!scope) return salas;

  const allowedSedes = scope.sedes || [];
  const allowedSalasBySede = scope.salas || {};

  return salas.filter((sala) => {
    const sedeKey = (sala.sede || "").toLowerCase();

    // Si el scope tiene lista de sedes, verificar que la sede esté permitida
    if (allowedSedes.length > 0 && !allowedSedes.includes(sedeKey)) {
      return false;
    }

    // Si el scope tiene lista específica de salas para esta sede, verificar
    if (allowedSalasBySede[sedeKey]) {
      const allowedSalasForSede = allowedSalasBySede[sedeKey];
      const salaKey = (sala.sala || "").toLowerCase();
      return allowedSalasForSede.includes(salaKey);
    }

    // Si la sede está en allowedSedes pero no hay restricción de salas específicas, permitir todas
    if (allowedSedes.includes(sedeKey)) {
      return true;
    }

    // Por defecto, denegar si hay scope definido
    return false;
  });
}

/**
 * Verifica si un usuario tiene acceso a una sede/sala específica
 * @param {string} sede - Nombre de la sede
 * @param {string} sala - Nombre de la sala
 * @param {Object|null} scope - Scope del usuario { sedes: [...], salas: { sede: [...] } }
 * @returns {boolean} - true si tiene acceso, false si no
 */
function hasAccessToSala(sede, sala, scope) {
  // null/undefined scope = acceso total (retrocompatibilidad)
  if (!scope) return true;

  const sedeKey = (sede || "").toLowerCase();
  const salaKey = (sala || "").toLowerCase();
  const allowedSedes = scope.sedes || [];
  const allowedSalasBySede = scope.salas || {};

  // Si el scope tiene lista de sedes y la sede NO está permitida, denegar
  if (allowedSedes.length > 0 && !allowedSedes.includes(sedeKey)) {
    return false;
  }

  // Si el scope tiene lista específica de salas para esta sede, verificar
  if (allowedSalasBySede[sedeKey]) {
    return allowedSalasBySede[sedeKey].includes(salaKey);
  }

  // Si la sede está en allowedSedes pero no hay restricción de salas específicas, permitir
  if (allowedSedes.includes(sedeKey)) {
    return true;
  }

  // Por defecto, denegar si hay scope definido pero no match
  return false;
}

// -------------------------------------------------------------
// OBS helpers
// -------------------------------------------------------------
async function withOBS(fn) {
  const obs = new OBSWebSocket();
  try {
    await obs.connect(OBS_SALA10.url, OBS_SALA10.password);
    const result = await fn(obs);
    try {
      await obs.disconnect();
    } catch (_) {}
    return { ok: true, ...result };
  } catch (error) {
    try {
      await obs.disconnect();
    } catch (_) {}
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code,
      responseData: error?.responseData,
    };
  }
}

// ✅ Helper genérico: ejecutar una llamada OBS y cerrar conexión
// ======================================================
// OBS POOL (multi-sala): mantiene conexiones por sala
// ======================================================
const __obsPool = new Map(); // key -> { obs, cfg, connected, connecting, lastUsed }

function __obsKey(obsCfg) {
  const ws = obsCfg.ws || obsCfg.url || "";
  const pw = obsCfg.password || "";
  return ws + "|" + pw;
}

async function __ensureConnected(entry) {
  if (entry.connected) return;
  if (entry.connecting) { await entry.connecting; return; }

  entry.connecting = (async () => {
    try {
      const ws = entry.cfg.ws || entry.cfg.url;
      await Promise.race([
        entry.obs.connect(ws, entry.cfg.password || ""),
        new Promise((_, rej) => setTimeout(() => rej(new Error("OBS connect timeout")), 1500)),
      ]);
      entry.connected = true;

      // si se cae, marcamos para reconectar en la próxima request
      entry.obs.on("ConnectionClosed", () => {
        entry.connected = false;
      });
    } finally {
      entry.connecting = null;
    }
  })();

  await entry.connecting;
}

// Helper genérico: ejecutar una llamada OBS usando pool (SIN desconectar por request)
async function obsCall(obsCfg, fn) {
  const key = __obsKey(obsCfg);
  let entry = __obsPool.get(key);

  if (!entry) {
    entry = {
      obs: new OBSWebSocket(),
      cfg: { ws: obsCfg.ws || obsCfg.url, password: obsCfg.password || "" },
      connected: false,
      connecting: null,
      lastUsed: Date.now(),
    };
    __obsPool.set(key, entry);
  } else {
    entry.lastUsed = Date.now();
    entry.cfg.ws = obsCfg.ws || obsCfg.url;
    entry.cfg.password = obsCfg.password || "";
  }

  try {
    await __ensureConnected(entry);
    const out = await fn(entry.obs);
    entry.lastUsed = Date.now();
    return out;
  } catch (e) {
    // si algo falla, forzamos reconexión en próxima request
    entry.connected = false;
    try { await entry.obs.disconnect(); } catch (_) {}
    throw e;
  }
}

// Limpieza de conexiones inactivas (TTL 30 min)
setInterval(async () => {
  const now = Date.now();
  for (const [key, entry] of __obsPool.entries()) {
    if (now - entry.lastUsed > 30 * 60 * 1000) {
      try { await entry.obs.disconnect(); } catch (_) {}
      __obsPool.delete(key);
    }
  }
}, 10 * 60 * 1000);
// Wrapper legacy (no rompemos nada)
async function obsSala10Call(fn) {
  return obsCall({ ws: OBS_SALA10.url, password: OBS_SALA10.password }, fn);
}

// ✅ SAFE wrapper para NO CRASHEAR el proceso si OBS tira error
async function safeObsSala10(fn) {
  try {
    const out = await obsSala10Call(fn);
    return { ok: true, ...out };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      code: e?.code,
      responseData: e?.responseData,
    };
  }
}

// -------------------------------------------------------------
// STREAM (SALA 10) - IDEMPOTENTE
// -------------------------------------------------------------
async function getSala10StreamStatus() {
  return withOBS(async (obs) => ({
    status: await obs.call("GetStreamStatus"),
  }));
}

async function startSala10Stream() {
  return withOBS(async (obs) => {
    const st = await obs.call("GetStreamStatus");
    if (st.outputActive) return { already: true, status: st };

    await obs.call("StartStream");
    const st2 = await obs.call("GetStreamStatus");
    return { started: true, status: st2 };
  });
}

async function stopSala10Stream() {
  return withOBS(async (obs) => {
    const st = await obs.call("GetStreamStatus");
    if (!st.outputActive) return { already: true, status: st };

    await obs.call("StopStream");
    const st2 = await obs.call("GetStreamStatus");
    return { stopped: true, status: st2 };
  });
}

// -------------------------------------------------------------
// RECORD (SALA 10) - IDEMPOTENTE + tolerante
// + resume idempotente: no 503 si no estaba pausado
// -------------------------------------------------------------
async function getSala10RecordStatus() {
  return withOBS(async (obs) => ({
    status: await obs.call("GetRecordStatus"),
  }));
}

async function startSala10Record() {
  return withOBS(async (obs) => {
    const st = await obs.call("GetRecordStatus");
    if (st.outputActive) return { already: true, status: st };

    try {
      await obs.call("StartRecord");

          // esperar un toque para que OBS empiece a escribir
          await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/already|in progress|active/i.test(msg)) {
        return { already: true, note: msg };
      }
      throw e;
    }

    const st2 = await obs.call("GetRecordStatus");
    return { started: true, status: st2 };
  });
}

async function stopSala10Record() {
  return withOBS(async (obs) => {
    const st = await obs.call("GetRecordStatus");
    if (!st.outputActive) return { already: true, status: st };

    try {
      await obs.call("StopRecord");
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/not recording|already|inactive/i.test(msg)) {
        return { already: true, note: msg };
      }
      throw e;
    }

    const st2 = await obs.call("GetRecordStatus");
    return { stopped: true, status: st2 };
  });
}

async function pauseSala10Record() {
  return withOBS(async (obs) => {
    try {
      await obs.call("PauseRecord");
      const st = await obs.call("GetRecordStatus");
      return { paused: true, status: st };
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/not recording|does not support|unsupported/i.test(msg)) {
        return { already: true, note: msg };
      }
      throw e;
    }
  });
}

async function resumeSala10Record() {
  return withOBS(async (obs) => {
    // idempotente: si no estaba pausado, NO es error
    try {
      const st0 = await obs.call("GetRecordStatus");
      if (!st0.outputActive) {
        return { already: true, note: "No estaba grabando", status: st0 };
      }
      if (st0.outputPaused === false) {
        return { already: true, note: "No estaba pausado", status: st0 };
      }

      await obs.call("ResumeRecord");
      const st = await obs.call("GetRecordStatus");
      return { resumed: true, status: st };
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/not recording|does not support|unsupported/i.test(msg)) {
        return { already: true, note: msg };
      }
      throw e;
    }
  });
}

// --------------------
// AUDIO HELPERS
// --------------------
async function getSala10Inputs() {
  return safeObsSala10(async (obs) => {
    const r = await obs.call("GetInputList");
    return { inputs: r.inputs || [] };
  });
}

async function toggleSala10InputMute(inputName) {
  return safeObsSala10(async (obs) => {
    const cur = await obs.call("GetInputMute", { inputName });
    const next = !cur.inputMuted;
    await obs.call("SetInputMute", { inputName, inputMuted: next });
    return { inputName, inputMuted: next };
  });
}

async function setSala10InputVolumeDb(inputName, db) {
  return safeObsSala10(async (obs) => {
    await obs.call("SetInputVolume", { inputName, inputVolumeDb: Number(db) });
    const vol = await obs.call("GetInputVolume", { inputName });
    return { inputName, ...vol };
  });
}

// --------------------
// SCENES / ITEMS (SALA 10)
// --------------------
async function getSala10Scenes() {
  return withOBS(async (obs) => {
    const data = await obs.call("GetSceneList");
    return {
      scenes: data.scenes || [],
      currentProgramSceneName: data.currentProgramSceneName,
      currentPreviewSceneName: data.currentPreviewSceneName ?? null,
    };
  });
}

async function getSala10SceneItems(sceneName) {
  return withOBS(async (obs) => {
    const data = await obs.call("GetSceneItemList", { sceneName });
    return { items: data.sceneItems || [] };
  });
}

async function setSala10Scene(sceneName) {
  return withOBS(async (obs) => {
    await obs.call("SetCurrentProgramScene", { sceneName });
    return {};
  });
}

async function setSala10SceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled) {
  return withOBS(async (obs) => {
    await obs.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: Number(sceneItemId),
      sceneItemEnabled: !!sceneItemEnabled,
    });
    return {};
  });
}

// Helper: toggle por nombre de item (sourceName) sin conocer id
async function toggleSala10SceneItemByName(sceneName, sourceName, enabled) {
  return withOBS(async (obs) => {
    const list = await obs.call("GetSceneItemList", { sceneName });
    const found = (list.sceneItems || []).find((it) => it.sourceName === sourceName);
    if (!found)
      throw new Error(`No existe scene item '${sourceName}' en escena '${sceneName}'`);

    await obs.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: found.sceneItemId,
      sceneItemEnabled: !!enabled,
    });

    return { sceneItemId: found.sceneItemId };
  });
}

// --------------------
// OVERLAY TEXTO (SALA 10)
// --------------------
async function setSala10OverlayText(text) {
  return withOBS(async (obs) => {
    const cur = await obs.call("GetInputSettings", {
      inputName: OBS_OVERLAY_AUDIENCIA_INPUT,
    });
    const inputSettings = { ...(cur.inputSettings || {}), text: String(text || "") };

    await obs.call("SetInputSettings", {
      inputName: OBS_OVERLAY_AUDIENCIA_INPUT,
      inputSettings,
      overlay: false,
    });

    return {};
  });
}

async function setSala10OverlayEnabled(enabled) {
  return withOBS(async (obs) => {
    const scenes = await obs.call("GetSceneList");
    const sceneName = scenes.currentProgramSceneName;
    if (!sceneName) throw new Error("No pude obtener escena actual (program)");

    const list = await obs.call("GetSceneItemList", { sceneName });
    const found = (list.sceneItems || []).find(
      (it) => it.sourceName === OBS_OVERLAY_AUDIENCIA_INPUT
    );
    if (!found)
      throw new Error(
        `No existe overlay '${OBS_OVERLAY_AUDIENCIA_INPUT}' en escena '${sceneName}'`
      );

    await obs.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: found.sceneItemId,
      sceneItemEnabled: !!enabled,
    });

    return { sceneName, sceneItemId: found.sceneItemId, enabled: !!enabled };
  });
}

// ---- Audio mute/mode ----
async function setSala10AudioMode(mode) {
  return withOBS(async (obs) => {
    if (mode === "desktop") {
      await obs.call("SetInputMute", {
        inputName: AUDIO_INPUTS_SALA10.desktop,
        inputMuted: false,
      });
      await obs.call("SetInputMute", {
        inputName: AUDIO_INPUTS_SALA10.micjack,
        inputMuted: true,
      });
    } else if (mode === "micjack") {
      await obs.call("SetInputMute", {
        inputName: AUDIO_INPUTS_SALA10.desktop,
        inputMuted: true,
      });
      await obs.call("SetInputMute", {
        inputName: AUDIO_INPUTS_SALA10.micjack,
        inputMuted: false,
      });
    } else {
      throw new Error("Modo inválido (usar 'desktop' o 'micjack')");
    }

    const desktop = await obs.call("GetInputMute", { inputName: AUDIO_INPUTS_SALA10.desktop });
    const micjack = await obs.call("GetInputMute", { inputName: AUDIO_INPUTS_SALA10.micjack });

    return {
      mode,
      desktopInput: AUDIO_INPUTS_SALA10.desktop,
      micjackInput: AUDIO_INPUTS_SALA10.micjack,
      desktopMuted: desktop.inputMuted,
      micjackMuted: micjack.inputMuted,
    };
  });
}

async function getSala10AudioState() {
  return withOBS(async (obs) => {
    const desktop = await obs.call("GetInputMute", { inputName: AUDIO_INPUTS_SALA10.desktop });
    const micjack = await obs.call("GetInputMute", { inputName: AUDIO_INPUTS_SALA10.micjack });

    return {
      desktopInput: AUDIO_INPUTS_SALA10.desktop,
      micjackInput: AUDIO_INPUTS_SALA10.micjack,
      desktopMuted: desktop.inputMuted,
      micjackMuted: micjack.inputMuted,
    };
  });
}

// ---- Audio volume ----
async function getSala10InputVolume(inputName) {
  return withOBS(async (obs) => {
    const vol = await obs.call("GetInputVolume", { inputName });
    return { inputName, ...vol };
  });
}

async function setSala10InputVolumeDb_Clamp(inputName, inputVolumeDb) {
  return withOBS(async (obs) => {
    const clamped = Math.max(-60, Math.min(10, Number(inputVolumeDb)));
    await obs.call("SetInputVolume", { inputName, inputVolumeDb: clamped });
    const vol = await obs.call("GetInputVolume", { inputName });
    return { inputName, ...vol, clamped };
  });
}

// ---- Stats ----
async function getSala10Stats() {
  return withOBS(async (obs) => ({
    stats: await obs.call("GetStats"),
  }));
}

// ---- Screenshot ----
async function screenshotSala10({ sourceName, width = 1280, height = 720, imageFormat = "png" }) {
  return withOBS(async (obs) => {
    let src = sourceName;
    if (!src) {
      const scenes = await obs.call("GetSceneList");
      src = scenes.currentProgramSceneName;
    }

    const data = await obs.call("GetSourceScreenshot", {
      sourceName: src,
      imageFormat,
      imageWidth: width,
      imageHeight: height,
      imageCompressionQuality: -1,
    });

    const m = /^data:image\/\w+;base64,(.+)$/.exec(data.imageData || "");
    if (!m) throw new Error("No pude obtener imageData");

    const buf = Buffer.from(m[1], "base64");

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `sala10_${ts}.${imageFormat}`;
    const filePath = path.join(SCREENSHOT_DIR, fileName);

    await fsp.writeFile(filePath, buf);

    return {
      sourceName: src,
      fileName,
      url: `${SCREENSHOT_URL_BASE}/${fileName}`,
    };
  });
}

// -------------------------------------------------------------
// RUTAS DEL BACKEND
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // AUDITORÍA: Registrar timestamp de inicio
  req._startTime = Date.now();

  // ✅ FIX: method/url canónicos para TODO el handler
  const method = (req.method || "").toUpperCase();
  const urlFull = req.url || "";
  const url = urlFull.split("?")[0];
  // ------------------------------
  // HEALTH (sin auth)
  // ------------------------------
  if ((method === "GET" || method === "HEAD") && url === "/health") {
    const obsPoolSize = (typeof __obsPool !== "undefined" && __obsPool && __obsPool.size) ? __obsPool.size : 0;
    const recordOpsSize = (typeof __recordOps !== "undefined" && __recordOps && __recordOps.size) ? __recordOps.size : 0;

    // git rev (best-effort)
    let gitRev = null;
    try {
      const { execSync } = require("child_process");
      gitRev = String(execSync("git rev-parse --short HEAD", { cwd: process.cwd() })).trim();
    } catch (_) {}

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      service: "ogaac-backend",
      ts: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      gitRev,
      obsPoolSize,
      recordOpsSize
    }));
    return;

  // ------------------------------
  // DEBUG: headers que llegan al backend (TEMPORAL)
  // ------------------------------
  if (method === "GET" && url === "/api/debug/headers") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      method,
      url: urlFull,
      headers: req.headers,
    }, null, 2));
    return;
  }

  }


  // ======================================================
  // ROUTER DINÁMICO MULTI-SALA (usa config/salas.json)
  // Atiende: /api/obs/:sede/:sala/*
  // ======================================================
  const __method = method;
  const __urlFull = urlFull;
  const __url = url;

  async function __readJsonBody() {
    return await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });
  }

  function __sendJson(code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  }

  
  // -----------------------------------------------------------
  // traceId + helpers de error/log para router dinámico
  // -----------------------------------------------------------
  const __traceId =
    (req.headers["x-request-id"] && String(req.headers["x-request-id"])) ||
    ("t" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));

  function __sendErr(httpStatus, code, extra = {}) {
    __sendJson(httpStatus, {
      ok: false,
      code,
      traceId: __traceId,
      sede: __dyn?.sede,
      sala: __dyn?.sala,
      rest: __dyn?.rest,
      ...extra,
    });
  }

  function __logDyn(level, msg, extra = {}) {
    const base = {
      level,
      traceId: __traceId,
      method: __method,
      url: __urlFull,
      sede: __dyn?.sede,
      sala: __dyn?.sala,
      rest: __dyn?.rest,
      ...extra,
    };
    if (level === "error") console.error("[DYN]", msg, base);
    else console.log("[DYN]", msg, base);
  }

function __parseDynObsRoute(pathOnly) {
    const parts = pathOnly.split("/").filter(Boolean); // ["api","obs",":sede",":sala",...]
    if (parts.length < 4) return null;
    if (parts[0] !== "api" || parts[1] !== "obs") return null;
    const sede = parts[2];
    const sala = parts[3];
    if (!sede || !sala) return null;
    if (sede.startsWith("sala")) return null; // solo estilo nuevo
    const rest = "/" + parts.slice(4).join("/");
    return { sede, sala, rest: rest === "/" ? "" : rest };
  }

  
    // -----------------------------------------------------------
    // GET /api/obs/config  (lista global de salas configuradas)
    // -----------------------------------------------------------
    if (__method === "GET" && __url === "/api/obs/config") {
      const payload = requireAuth(req);
      if (!payload) {
        __sendJson(403, {
          ok: false,
          code: "AUTH_DENIED",
          message: "Acceso denegado",
          traceId: __traceId,
        });
        return;
      }

      const snapshot = buildSalasSnapshot({ traceId: __traceId });
      if (!snapshot.ok) {
        __sendJson(500, {
          ok: false,
          code: "CONFIG_LOAD_FAILED",
          traceId: __traceId,
          error: snapshot.error,
        });
        return;
      }

      // SCOPE: Obtener scope del usuario y filtrar salas
      let userScope = null;
      try {
        const userFromFile = await usersManager.getUser(payload.username);
        if (userFromFile && userFromFile.scope) {
          userScope = userFromFile.scope;
        }
      } catch (err) {
        console.error("[/api/obs/config] Error obteniendo scope:", err);
      }

      // Filtrar salas según scope del usuario (null = todas)
      const filteredSalas = filterSalasByScope(snapshot.publicList, userScope);

      __sendJson(200, {
        ok: true,
        traceId: __traceId,
        counts: snapshot.counts,
        warnings: snapshot.warnings,
        salas: filteredSalas,
      });
      return;
    }

    if (__method === "GET" && __url === "/api/obs/config/full") {
      const payload = requireAuth(req);
      const isAdmin = payload && String(payload.role || "").toLowerCase() === "admin";
      const local = isLocalRequest(req);

      if (!isAdmin && !local) {
        __sendJson(403, {
          ok: false,
          code: "ADMIN_ONLY",
          message: "Solo disponible para admin o localhost",
          traceId: __traceId,
        });
        return;
      }

      const snapshot = buildSalasSnapshot({ traceId: __traceId });
      if (!snapshot.ok) {
        __sendJson(500, {
          ok: false,
          code: "CONFIG_LOAD_FAILED",
          traceId: __traceId,
          error: snapshot.error,
        });
        return;
      }

      __sendJson(200, {
        ok: true,
        traceId: __traceId,
        counts: snapshot.counts,
        warnings: snapshot.warnings,
        salas: snapshot.fullList,
      });
      return;
    }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUTAS DINÁMICAS OBS: /api/obs/:sede/:sala/*
  // ═══════════════════════════════════════════════════════════════════════════
  // ⚠️ GUARDRAIL CRÍTICO:
  //    TODAS las rutas OBS que usan :sede/:sala DEBEN pasar por este bloque
  //    y VALIDAR scope con hasAccessToSala() ANTES de ejecutar cualquier acción.
  //
  //    NO agregue endpoints OBS fuera de este handler dinámico.
  //    Si necesita un endpoint especial, valide scope aquí primero.
  // ═══════════════════════════════════════════════════════════════════════════
  const __dyn = __parseDynObsRoute(__url);
  if (__dyn) {
    const payload = requireAuth(req);
    if (!payload) {
      __sendErr(403, "AUTH_DENIED", { message: "Acceso denegado" });
      return;
    }

    // SCOPE: Verificar si el usuario tiene acceso a esta sede/sala
    let userScope = null;
    try {
      const userFromFile = await usersManager.getUser(payload.username);
      if (userFromFile && userFromFile.scope) {
        userScope = userFromFile.scope;
      }
    } catch (err) {
      console.error("[SCOPE] Error obteniendo scope:", err);
    }

    // Validar acceso según scope (null = acceso total)
    if (!hasAccessToSala(__dyn.sede, __dyn.sala, userScope)) {
      __sendErr(403, "SCOPE_DENIED", {
        message: `No tienes permiso para acceder a ${__dyn.sede}/${__dyn.sala}`,
        sede: __dyn.sede,
        sala: __dyn.sala
      });
      return;
    }

    const __cfgSnapshot = buildSalasSnapshot({ traceId: __traceId });
    if (!__cfgSnapshot.ok) {
      __sendErr(500, "OBS_CONFIG_LOAD_FAILED", {
        message: __cfgSnapshot.error?.message || "No pude cargar config",
        error: __cfgSnapshot.error,
      });
      return;
    }
  const obsCfg = (__cfgSnapshot.mergedTree[__dyn.sede] || {})[__dyn.sala];
    if (!obsCfg) {
      __sendErr(404, "SALA_NOT_CONFIGURED", { error: "Sala no configurada en config/salas.json" });
      return;
    }

    try {

      // ---- GET /config (lista de salas configuradas) ----

      // Devuelve solo datos públicos (sin passwords)

      if (__method === "GET" && __dyn.rest === "/config") {
        __sendJson(200, {
          ok: true,
          traceId: __traceId,
          counts: __cfgSnapshot.counts,
          warnings: __cfgSnapshot.warnings,
          salas: __cfgSnapshot.publicList,
        });
        return;
      }


      // ---- GET /status
      if (__method === "GET" && __dyn.rest === "/status") {
        const out = await obsCall(obsCfg, async (obs) => ({
          status: await obs.call("GetStreamStatus"),
        }));
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- POST /stream/start (IDEMPOTENTE)
      if (__method === "POST" && __dyn.rest === "/stream/start") {
        const out = await obsCall(obsCfg, async (obs) => {
          const st = await obs.call("GetStreamStatus");
          if (st.outputActive) return { already: true, status: st };
          await obs.call("StartStream");
          const st2 = await obs.call("GetStreamStatus");
          return { started: true, status: st2 };
        });
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- POST /stream/stop (IDEMPOTENTE)
      if (__method === "POST" && __dyn.rest === "/stream/stop") {
        const out = await obsCall(obsCfg, async (obs) => {
          const st = await obs.call("GetStreamStatus");
          if (!st.outputActive) return { already: true, status: st };
          await obs.call("StopStream");
          const st2 = await obs.call("GetStreamStatus");
          return { stopped: true, status: st2 };
        });
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- Inputs
      if (__method === "GET" && __dyn.rest === "/inputs") {
        const out = await obsCall(obsCfg, async (obs) => ({
          inputs: await obs.call("GetInputList"),
        }));
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- Audio mute toggle
      if (__method === "POST" && __dyn.rest === "/audio/mute/toggle") {
        const body = await __readJsonBody();
        const inputName = body.inputName;
        if (!inputName) {
          __sendJson(400, { ok: false, error: "Falta inputName" });
          return;
        }
        const out = await obsCall(obsCfg, async (obs) => {
          const cur = await obs.call("GetInputMute", { inputName });
          const next = !cur.inputMuted;
          await obs.call("SetInputMute", { inputName, inputMuted: next });
          return { inputName, inputMuted: next };
        });
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- Audio volume set
      if (__method === "POST" && __dyn.rest === "/audio/volume/set") {
        const body = await __readJsonBody();
        const inputName = body.inputName;
        const db = body.inputVolumeDb ?? body.db;
        if (!inputName || db === undefined) {
          __sendJson(400, {
            ok: false,
            error: "Falta inputName o inputVolumeDb/db",
          });
          return;
        }
        const out = await obsCall(obsCfg, async (obs) => {
          await obs.call("SetInputVolume", { inputName, inputVolumeDb: Number(db) });
          const vol = await obs.call("GetInputVolume", { inputName });
          return { inputName, volume: vol };
        });
        __sendJson(200, { ok: true, ...out });
        return;
      }

      // ---- Record ----
                  if (__method === "POST" && __dyn.rest === "/record/start") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        // Si ya hay operación en curso, devolvemos 202
        if (op.state === "starting") {
          __sendJson(202, { ok: true, status: "starting", sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }

        // Si según memoria ya está activo, igual confirmamos con OBS (por si se reinició OBS)
        if (op.state === "active") {
          try {
            const st = await obsCall(obsCfg, async (obs) => await obs.call("GetRecordStatus"));
            if (st && st.outputActive) {
              __sendJson(200, { ok: true, already: true, status: st, op });
              return;
            }
          } catch (e) {
            // si falla, seguimos con start normal
          }
        }

        __setRecState(op, "starting", { lastError: null });

        try {
          const out = await obsCall(obsCfg, async (obs) => {
            // Intentar iniciar (si ya está grabando, OBS puede fallar o ignorar)
            try { await obs.call("StartRecord"); } catch (_) {}

            // Esperar un toque y consultar estado
            await new Promise(r => setTimeout(r, 500));

            // Poll hasta ver outputActive:true o bytes/duración > 0 (máx ~10s)
            let st = await obs.call("GetRecordStatus");
            for (let i = 0; i < 40; i++) {
              const bytes = Number(st.outputBytes || 0);
              const dur = Number(st.outputDuration || 0);
              if (st.outputActive || bytes > 0 || dur > 0) break;
              await new Promise(r => setTimeout(r, 250));
              st = await obs.call("GetRecordStatus");
            }

            return { status: st };
          });

          const st = out.status || out;
          if (st && (st.outputActive || Number(st.outputBytes || 0) > 0 || Number(st.outputDuration || 0) > 0)) {
            __setRecState(op, "active");
            __sendJson(200, { ok: true, started: true, status: st, op });
            return;
          }

          __setRecState(op, "error", { lastError: "timeout esperando outputActive/bytes/duration" });
          __sendJson(504, {
            ok: false,
            code: "OBS_TIMEOUT_OUTPUT_ACTIVE",
            sede: __dyn.sede,
            sala: __dyn.sala,
            op,
          });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }

                  if (__method === "POST" && __dyn.rest === "/record/stop") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        if (op.state === "stopping") {
          __sendJson(202, { ok: true, status: "stopping", sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }

        __setRecState(op, "stopping", { lastError: null });

        try {
          const out = await obsCall(obsCfg, async (obs) => {
            const before = await obs.call("GetRecordStatus");

            // Si ya no estaba grabando, devolvemos idempotente
            if (!before.outputActive) {
              return { already: true, beforeStop: before, stop: null, status: before, outputPath: null };
            }

            const stopRes = await obs.call("StopRecord");

            // intentar capturar outputPath si existe
            const outputPath = (stopRes && (stopRes.outputPath || stopRes.outputFileName || stopRes.outputFilename)) || null;

            // poll hasta que outputActive sea false (máx ~10s)
            let st = await obs.call("GetRecordStatus");
            for (let i = 0; i < 40 && st.outputActive; i++) {
              await new Promise(r => setTimeout(r, 250));
              st = await obs.call("GetRecordStatus");
            }

            return { stopped: true, beforeStop: before, stop: stopRes, status: st, outputPath };
          });

          if (out.already) {
            __setRecState(op, "idle");
            __sendJson(200, { ok: true, already: true, ...out, op });
            return;
          }

          __setRecState(op, "idle", { lastOutputPath: out.outputPath || op.lastOutputPath });
          __sendJson(200, { ok: true, ...out, op });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }


      if (__method === "POST" && __dyn.rest === "/record/pause") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        try {
          const out = await obsCall(obsCfg, async (obs) => {
            const st0 = await obs.call("GetRecordStatus");

            // idempotente: si no estaba grabando -> no es error
            if (!st0.outputActive) {
              return { already: true, note: "No estaba grabando", status: st0 };
            }

            // si ya está pausado -> no es error
            if (st0.outputPaused === true) {
              return { already: true, note: "Ya estaba pausado", status: st0 };
            }

            await obs.call("PauseRecord");
            const st2 = await obs.call("GetRecordStatus");
            return { paused: true, status: st2 };
          });

          // si está activo, marcamos active (pausado sigue siendo active en términos de sesión)
          if (out.status && out.status.outputActive) __setRecState(op, "active");
          if (out.status && !out.status.outputActive) __setRecState(op, "idle");

          __sendJson(200, { ok: true, ...out, op });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }

                  if (__method === "GET" && __dyn.rest === "/record/status") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        try {
          const st = await obsCall(obsCfg, async (obs) => {
            let s0 = await obs.call("GetRecordStatus");

            // Si está activo pero aún no hay bytes/duración, reintentar un toque
            for (let i = 0; i < 6 && s0.outputActive && (Number(s0.outputBytes || 0) === 0) && (Number(s0.outputDuration || 0) === 0); i++) {
              await new Promise(r => setTimeout(r, 250));
              s0 = await obs.call("GetRecordStatus");
            }

            return s0;
          });

          // ajustar estado memo según OBS real
          if (st && st.outputActive) __setRecState(op, "active");
          if (st && !st.outputActive && op.state === "active") __setRecState(op, "idle");

          __sendJson(200, { ok: true, status: st, op });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }
if (__method === "POST" && __dyn.rest === "/record/resume") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        try {
          const out = await obsCall(obsCfg, async (obs) => {
            const st0 = await obs.call("GetRecordStatus");

            // idempotente: si no estaba grabando -> no es error
            if (!st0.outputActive) {
              return { already: true, note: "No estaba grabando", status: st0 };
            }

            // idempotente: si no estaba pausado -> no es error
            if (st0.outputPaused === false) {
              return { already: true, note: "No estaba pausado", status: st0 };
            }

            // si estaba pausado, reanudar
            await obs.call("ResumeRecord");
            const st2 = await obs.call("GetRecordStatus");
            return { resumed: true, status: st2 };
          });

          // actualizar op segun estado real
          if (out.status && out.status.outputActive) __setRecState(op, "active");
          if (out.status && !out.status.outputActive) __setRecState(op, "idle");

          __sendJson(200, { ok: true, ...out, op });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }

      // ---- Scenes ----
      if (__method === "GET" && __dyn.rest === "/scenes") {
        const out = await obsCall(obsCfg, async (obs) => ({
          ...(await obs.call("GetSceneList")),
          currentProgramSceneName: (await obs.call("GetCurrentProgramScene")).currentProgramSceneName,
        }));
        __sendJson(200, { ok: true, ...out });
        return;
      }

      if (__method === "POST" && __dyn.rest === "/scene/set") {
        const body = await __readJsonBody();
        const sceneName = (body.sceneName || "").trim();
        if (!sceneName) {
          __sendJson(400, { ok: false, error: "Falta sceneName" });
          return;
        }
        const out = await obsCall(obsCfg, async (obs) => {
          await obs.call("SetCurrentProgramScene", { sceneName });
          const cur = await obs.call("GetCurrentProgramScene");
          return { set: true, currentProgramSceneName: cur.currentProgramSceneName };
        });
        __sendJson(200, { ok: true, ...out });
        return;
      }
      
      // ---- State (stream + record + op)
      if (__method === "GET" && __dyn.rest === "/state") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        try {
          const out = await obsCall(obsCfg, async (obs) => {
            const stream = await obs.call("GetStreamStatus");
            const record = await obs.call("GetRecordStatus");
            return { stream, record };
          });

          // ajustar estado memo según OBS real
          if (out.record && out.record.outputActive) __setRecState(op, "active");
          if (out.record && !out.record.outputActive && op.state === "active") __setRecState(op, "idle");

          __sendJson(200, { ok: true, sede: __dyn.sede, sala: __dyn.sala, ...out, op });
          return;
        } catch (e) {
          __setRecState(op, "error", { lastError: String(e?.message || e) });
          __sendJson(500, { ok: false, error: String(e?.message || e), sede: __dyn.sede, sala: __dyn.sala, op });
          return;
        }
      }


      // ---- Summary (stream + record + state) ----
      if (__method === "GET" && __dyn.rest === "/summary") {
        const op = __getRecOp(__dyn.sede, __dyn.sala);

        const out = await obsCall(obsCfg, async (obs) => {
          const stream = await obs.call("GetStreamStatus");
          let record = await obs.call("GetRecordStatus");

          // Si está grabando pero aún no hay bytes/duración, reintentar un toque
          for (let i = 0; i < 6 && record.outputActive && (Number(record.outputBytes || 0) === 0) && (Number(record.outputDuration || 0) === 0); i++) {
            await new Promise(r => setTimeout(r, 250));
            record = await obs.call("GetRecordStatus");
          }

          return { stream, record };
        });

        __sendJson(200, {
          ok: true,
          traceId: __traceId,
          sede: __dyn.sede,
          sala: __dyn.sala,
          state: {
            state: op.state,
            ts: op.ts,
            lastOutputPath: op.lastOutputPath,
            lastError: op.lastError,
          },
          stream: out.stream,
          record: out.record
        });
        return;
      }

__sendErr(404, "DYN_ROUTE_NOT_IMPLEMENTED", { error: "Ruta dinámica no implementada" });
      return;
     } catch (e) {
      __logDyn("error", "dyn handler failed", { error: String(e?.message || e) });
      __sendErr(500, "DYN_HANDLER_FAILED", { error: String(e?.message || e) });
      return;
    }
  }

  // ============================================================
  // OBS · SALA 10 (todas estas requieren auth)
  // ============================================================
  if (url.startsWith("/api/obs/")) {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 403, { ok: false, message: "Acceso denegado" });
  }

  // ------------------------------
  // LOGIN
  // ------------------------------
  // LOGIN (soporta users-roles.json + .env)
  // ------------------------------
  if (method === "POST" && url === "/api/login") {
    try {
      const body = await readBody(req);
      const username = (body.username || body.user || "").trim();
      const password = body.password || body.pass || "";

      if (!username || !password) return sendJson(res, 400, { ok: false, message: "Faltan datos" });

      let role = null;

      // 1) Intentar con users-roles.json (usuarios locales)
      const isValidFromFile = await usersManager.verifyPassword(username, password);
      if (isValidFromFile) {
        const user = await usersManager.getUser(username);
        if (user && user.enabled !== false) {
          role = user.role || "operator";
        }
      }

      // 2) Fallback: usuario de .env (VALID_USERS)
      if (!role) {
        const expected = VALID_USERS[username];
        const expectedPass =
          expected && typeof expected === "object" ? expected.password : expected;
        if (expectedPass && expectedPass === password) {
          role = expected && typeof expected === "object" && expected.role
            ? expected.role
            : "operator";
        }
      }

      // 3) Si no autenticó por ningún lado, rechazar
      if (!role) {
        return sendJson(res, 401, { ok: false, message: "Usuario o contraseña incorrectos" });
      }

      // 4) Generar token
      const token = jwt.sign({ username, role }, SECRET, { expiresIn: "8h" });

      const cookie = [
        `ogaac_token=${token}`,
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        "Max-Age=28800",
      ].join("; ");

      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": cookie });
      res.end(JSON.stringify({ ok: true, token, role }));
      return;
    } catch (e) {
      console.error("Error en /api/login:", e);
      return sendJson(res, 500, { ok: false, message: "Error interno" });
    }
  }

  // ------------------------------
  // CHECK TOKEN
  // ------------------------------
  if ((method === "GET" || method === "HEAD") && url === "/api/check") {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });
    return sendJson(res, 200, { ok: true, user: payload.username, role: payload.role || null });
  }

  // ------------------------------
  // GET /api/me (alias de /api/check, para auth-rbac.js)
  // ------------------------------
  if ((method === "GET" || method === "HEAD") && url === "/api/me") {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido o expirado" });

    // SCOPE: Obtener scope del usuario (si existe) desde users-roles.json
    let scope = null;
    try {
      const userFromFile = await usersManager.getUser(payload.username);
      if (userFromFile && userFromFile.scope) {
        scope = userFromFile.scope;
      }
    } catch (err) {
      console.error("[/api/me] Error obteniendo scope:", err);
    }

    return sendJson(res, 200, {
      ok: true,
      user: payload.username,
      role: payload.role || "operator",
      scope: scope, // null = acceso total (compatibilidad retroactiva)
    });
  }

  // ------------------------------
  // GET /api/admin/users (listar usuarios - requiere rol admin)
  // ------------------------------
  if (method === "GET" && url === "/api/admin/users") {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });

    // Solo admin puede listar usuarios
    if (payload.role !== "admin") {
      return sendJson(res, 403, { ok: false, message: "Acceso denegado: requiere rol admin" });
    }

    try {
      // Leer usuarios de users-roles.json (persistencia)
      const users = await usersManager.listUsers();

      // Agregar usuario de .env si no está en la lista (compatibilidad)
      const envUser = VALID_USERS[Object.keys(VALID_USERS)[0]];
      const envUsername = Object.keys(VALID_USERS)[0];

      if (envUser && !users.find(u => u.username === envUsername)) {
        users.push({
          username: envUsername,
          role: envUser.role || "admin",
          enabled: true,
          source: "env",
          createdAt: null,
          updatedAt: null,
          note: "Usuario de .env (read-only)"
        });
      }

      return sendJson(res, 200, { ok: true, users });
    } catch (err) {
      console.error("[/api/admin/users GET] Error:", err);
      return sendJson(res, 500, { ok: false, message: "Error al listar usuarios" });
    }
  }

  // ------------------------------
  // POST /api/admin/users (crear usuario local - requiere rol admin)
  // ------------------------------
  if (method === "POST" && url === "/api/admin/users") {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });

    if (payload.role !== "admin") {
      return sendJson(res, 403, { ok: false, message: "Acceso denegado: requiere rol admin" });
    }

    try {
      const body = await readBody(req);
      const { username, password, role, note, scope } = body;

      const result = await usersManager.createUser({ username, password, role, note, scope });

      if (!result.ok) {
        await auditLog(req, res, { action: "create_user_failed", targetUser: username });
        return sendJson(res, 400, { ok: false, message: result.error });
      }

      // AUDITORÍA: Usuario creado
      await auditLog(req, res, { action: "create_user", targetUser: username, targetRole: role });

      return sendJson(res, 201, { ok: true, user: result.user });
    } catch (err) {
      console.error("[/api/admin/users POST] Error:", err);
      return sendJson(res, 500, { ok: false, message: "Error al crear usuario" });
    }
  }

  // ------------------------------
  // PUT /api/admin/users/:username (editar usuario - requiere rol admin)
  // ------------------------------
  if (method === "PUT" && url.startsWith("/api/admin/users/")) {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });

    if (payload.role !== "admin") {
      return sendJson(res, 403, { ok: false, message: "Acceso denegado: requiere rol admin" });
    }

    try {
      const username = decodeURIComponent(url.split("/api/admin/users/")[1]);
      const body = await readBody(req);

      const result = await usersManager.updateUser(username, body);

      if (!result.ok) {
        await auditLog(req, res, { action: "update_user_failed", targetUser: username });
        return sendJson(res, 400, { ok: false, message: result.error });
      }

      // AUDITORÍA: Usuario actualizado
      await auditLog(req, res, { action: "update_user", targetUser: username, changes: Object.keys(body) });

      return sendJson(res, 200, { ok: true, user: result.user });
    } catch (err) {
      console.error("[/api/admin/users PUT] Error:", err);
      return sendJson(res, 500, { ok: false, message: "Error al actualizar usuario" });
    }
  }

  // ------------------------------
  // DELETE /api/admin/users/:username (eliminar usuario - requiere rol admin)
  // ------------------------------
  if (method === "DELETE" && url.startsWith("/api/admin/users/")) {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });

    if (payload.role !== "admin") {
      return sendJson(res, 403, { ok: false, message: "Acceso denegado: requiere rol admin" });
    }

    try {
      const username = decodeURIComponent(url.split("/api/admin/users/")[1]);

      const result = await usersManager.deleteUser(username);

      if (!result.ok) {
        await auditLog(req, res, { action: "delete_user_failed", targetUser: username });
        return sendJson(res, 400, { ok: false, message: result.error });
      }

      // AUDITORÍA: Usuario eliminado
      await auditLog(req, res, { action: "delete_user", targetUser: username });

      return sendJson(res, 200, { ok: true, message: result.message });
    } catch (err) {
      console.error("[/api/admin/users DELETE] Error:", err);
      return sendJson(res, 500, { ok: false, message: "Error al eliminar usuario" });
    }
  }

  // ------------------------------
  // GET /api/admin/audit (consultar log de auditoría - requiere rol admin)
  // Parámetros: date, limit, user, action, contains
  // ------------------------------
  if (method === "GET" && url.startsWith("/api/admin/audit")) {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 401, { ok: false, message: "Token inválido" });

    if (payload.role !== "admin") {
      return sendJson(res, 403, { ok: false, message: "Acceso denegado: requiere rol admin" });
    }

    try {
      const urlObj = new URL("http://localhost" + urlFull);
      const dateParam = urlObj.searchParams.get("date");
      const limitParam = urlObj.searchParams.get("limit");
      const userParam = urlObj.searchParams.get("user");
      const actionParam = urlObj.searchParams.get("action");
      const containsParam = urlObj.searchParams.get("contains");

      // Validar date (YYYY-MM-DD estricto, solo dígitos y guiones)
      let targetDate = new Date().toISOString().split("T")[0]; // Default: hoy
      if (dateParam) {
        const dateRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
        if (!dateRegex.test(dateParam)) {
          return sendJson(res, 400, {
            ok: false,
            message: "Formato de fecha inválido. Use YYYY-MM-DD"
          });
        }
        // Validar que sea una fecha real
        const parsed = new Date(dateParam + "T00:00:00Z");
        if (isNaN(parsed.getTime())) {
          return sendJson(res, 400, {
            ok: false,
            message: "Fecha inválida. Use YYYY-MM-DD"
          });
        }
        targetDate = dateParam;
      }

      // Validar limit (default: 200, hard cap: 500)
      const MAX_LIMIT = 500;
      let limit = 200;
      if (limitParam) {
        const parsed = parseInt(limitParam, 10);
        if (isNaN(parsed) || parsed < 1) {
          return sendJson(res, 400, {
            ok: false,
            message: "El parámetro limit debe ser un número mayor a 0"
          });
        }
        limit = Math.min(parsed, MAX_LIMIT); // Clamp a MAX_LIMIT
      }

      // Validar filtros de string (max 128 chars c/u)
      const MAX_FILTER_LEN = 128;
      const filters = {};

      if (userParam) {
        if (userParam.length > MAX_FILTER_LEN) {
          return sendJson(res, 400, {
            ok: false,
            message: `El parámetro user excede ${MAX_FILTER_LEN} caracteres`
          });
        }
        filters.user = userParam;
      }

      if (actionParam) {
        if (actionParam.length > MAX_FILTER_LEN) {
          return sendJson(res, 400, {
            ok: false,
            message: `El parámetro action excede ${MAX_FILTER_LEN} caracteres`
          });
        }
        filters.action = actionParam;
      }

      if (containsParam) {
        if (containsParam.length > MAX_FILTER_LEN) {
          return sendJson(res, 400, {
            ok: false,
            message: `El parámetro contains excede ${MAX_FILTER_LEN} caracteres`
          });
        }
        filters.contains = containsParam;
      }

      // Leer log de auditoría con filtros
      const events = await readAuditLog(targetDate, limit, filters);

      // Listar fechas disponibles (bonus)
      const availableDates = await listAuditDates();

      return sendJson(res, 200, {
        ok: true,
        date: targetDate,
        count: events.length,
        limit,
        filters,
        events,
        availableDates: availableDates.slice(0, 30), // Últimas 30 fechas
      });
    } catch (err) {
      console.error("[/api/admin/audit GET] Error:", err);
      return sendJson(res, 500, { ok: false, message: "Error al leer auditoría" });
    }
  }

  // ------------------------------
  // LISTADO DE JUZGADO 01
  // ------------------------------
  if (method === "GET" && url === "/api/juzgado01") {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 403, { ok: false, message: "Acceso denegado" });

    const folder = path.join(BASE_AUD, "Juzgado01");
    try {
      const files = await fsp.readdir(folder);
      const lista = files
        .filter((f) => /\.(mp4|wmv|mkv|webm)$/i.test(f))
        .map((f) => ({ nombre: f, url: "/api/video?file=" + encodeURIComponent(f) }));
      return sendJson(res, 200, { ok: true, archivos: lista });
    } catch (e) {
      console.error("Error leyendo carpeta Juzgado01:", e);
      return sendJson(res, 500, { ok: false, message: "Error leyendo carpeta" });
    }
  }

  // ------------------------------
  // SERVIR VIDEO SEGURO (con soporte de Range / 206)
  // ------------------------------
  if (method === "GET" && url.startsWith("/api/video")) {
    const payload = requireAuth(req);
    if (!payload) return sendJson(res, 403, { ok: false, message: "Acceso denegado" });

    const params = new URL("http://x" + url).searchParams;
    const file = params.get("file");
    if (!file) return sendJson(res, 400, { ok: false, message: "Falta archivo" });

    let safeName;
    try {
      safeName = decodeURIComponent(file);
    } catch {
      safeName = file;
    }

    safeName = path.basename(safeName);

    const baseFolder = path.join(BASE_AUD, "Juzgado01");
    const filePath = path.join(baseFolder, safeName);

    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { ok: false, message: "No existe archivo", filePath });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    const ext = path.extname(safeName).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".webm") contentType = "video/webm";
    else if (ext === ".mkv") contentType = "video/x-matroska";
    else if (ext === ".wmv") contentType = "video/x-ms-wmv";

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start < 0 || start >= fileSize) {
        res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
        return res.end();
      }

      const finalEnd = isNaN(end) || end >= fileSize ? fileSize - 1 : end;
      const chunkSize = finalEnd - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${finalEnd}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${safeName}"`,
      });

      const stream = fs.createReadStream(filePath, { start, end: finalEnd });
      stream.on("error", () => res.end());
      return stream.pipe(res);
    }

    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${safeName}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.end());
    return stream.pipe(res);
  }

  if (false) {
  // ---- Stream ----
  if (method === "GET" && url === "/api/obs/sala10/status")
    return sendJson(res, 200, await getSala10StreamStatus());

  if (method === "POST" && url === "/api/obs/sala10/stream/start")
    return sendJson(res, 200, await startSala10Stream());

  if (method === "POST" && url === "/api/obs/sala10/stream/stop")
    return sendJson(res, 200, await stopSala10Stream());

  // ---- Record ----
  if (method === "GET" && url === "/api/obs/sala10/record/status")
    return sendJson(res, 200, await getSala10RecordStatus());

  if (method === "POST" && url === "/api/obs/sala10/record/start")
    return sendJson(res, 200, await startSala10Record());

  if (method === "POST" && url === "/api/obs/sala10/record/stop")
    return sendJson(res, 200, await stopSala10Record());

  if (method === "POST" && url === "/api/obs/sala10/record/pause")
    return sendJson(res, 200, await pauseSala10Record());

  if (method === "POST" && url === "/api/obs/sala10/record/resume")
    return sendJson(res, 200, await resumeSala10Record());

  // ---- Inputs ----
  if (method === "GET" && url === "/api/obs/sala10/inputs") {
    const result = await getSala10Inputs();
    return sendJson(res, 200, result);
  }

  // ---- Audio toggle mute ----
  if (method === "POST" && url === "/api/obs/sala10/audio/mute/toggle") {
    const body = await readBody(req);
    if (!body.inputName) return sendJson(res, 400, { ok: false, error: "Falta inputName" });
    const result = await toggleSala10InputMute(body.inputName);
    return sendJson(res, 200, result);
  }

  // ---- Scenes ----
  if (method === "GET" && url === "/api/obs/sala10/scenes")
    return sendJson(res, 200, await getSala10Scenes());

  if (method === "POST" && url === "/api/obs/sala10/scene/set") {
    try {
      const body = await readBody(req);
      const sceneName = (body.sceneName || "").trim();
      if (!sceneName) return sendJson(res, 400, { ok: false, message: "Falta sceneName" });
      return sendJson(res, 200, await setSala10Scene(sceneName));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  if (method === "POST" && url === "/api/obs/sala10/scene/items") {
    try {
      const body = await readBody(req);
      const sceneName = (body.sceneName || "").trim();
      if (!sceneName) return sendJson(res, 400, { ok: false, message: "Falta sceneName" });
      return sendJson(res, 200, await getSala10SceneItems(sceneName));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  if (method === "POST" && url === "/api/obs/sala10/scene/item/enabled") {
    try {
      const body = await readBody(req);
      const sceneName = (body.sceneName || "").trim();
      const sceneItemId = Number(body.sceneItemId);
      const sceneItemEnabled = !!body.sceneItemEnabled;

      if (!sceneName) return sendJson(res, 400, { ok: false, message: "Falta sceneName" });
      if (!Number.isFinite(sceneItemId))
        return sendJson(res, 400, { ok: false, message: "Falta sceneItemId" });

      return sendJson(
        res,
        200,
        await setSala10SceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled)
      );
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  if (method === "POST" && url === "/api/obs/sala10/scene/item/toggle-by-name") {
    try {
      const body = await readBody(req);
      const sceneName = (body.sceneName || "").trim();
      const sourceName = (body.sourceName || "").trim();
      const enabled = body.enabled;

      if (!sceneName) return sendJson(res, 400, { ok: false, message: "Falta sceneName" });
      if (!sourceName) return sendJson(res, 400, { ok: false, message: "Falta sourceName" });
      if (typeof enabled !== "boolean")
        return sendJson(res, 400, { ok: false, message: "Falta enabled (boolean)" });

      return sendJson(res, 200, await toggleSala10SceneItemByName(sceneName, sourceName, enabled));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  // ---- Audio mode ----
  if (method === "GET" && url === "/api/obs/sala10/audio/state")
    return sendJson(res, 200, await getSala10AudioState());

  if (method === "POST" && url === "/api/obs/sala10/audio/mode") {
    try {
      const body = await readBody(req);
      const mode = (body.mode || "").trim();
      return sendJson(res, 200, await setSala10AudioMode(mode));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  // ---- Audio volume get ----
  if (method === "POST" && url === "/api/obs/sala10/audio/volume/get") {
    try {
      const body = await readBody(req);
      const inputName = (body.inputName || "").trim();
      if (!inputName) return sendJson(res, 400, { ok: false, message: "Falta inputName" });
      return sendJson(res, 200, await getSala10InputVolume(inputName));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  // ---- Audio volume set (clamp) ----
  if (method === "POST" && url === "/api/obs/sala10/audio/volume/set") {
    try {
      const body = await readBody(req);
      const inputName = (body.inputName || "").trim();
      const inputVolumeDb = Number(body.inputVolumeDb);

      if (!inputName) return sendJson(res, 400, { ok: false, message: "Falta inputName" });
      if (!Number.isFinite(inputVolumeDb))
        return sendJson(res, 400, { ok: false, message: "Falta inputVolumeDb (number)" });

      return sendJson(res, 200, await setSala10InputVolumeDb_Clamp(inputName, inputVolumeDb));
    } catch {
      return sendJson(res, 400, { ok: false, message: "Body inválido" });
    }
  }

  // ---- Stats ----
  if (method === "GET" && url === "/api/obs/sala10/stats")
    return sendJson(res, 200, await getSala10Stats());

  // ---- Screenshot ----
  if (method === "POST" && url === "/api/obs/sala10/screenshot") {
    try {
      const body = await readBody(req);
      const sourceName = body.sourceName ? String(body.sourceName).trim() : null;
      const width = body.width ? Number(body.width) : 1280;
      const height = body.height ? Number(body.height) : 720;
      const imageFormat = body.imageFormat ? String(body.imageFormat).trim() : "png";

      return sendJson(res, 200, await screenshotSala10({ sourceName, width, height, imageFormat }));
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: "Body inválido", error: e.message });
    }
  }

  // ============================================================
  // AUDIENCIA ACTUAL (SALA 10) - metadata + overlay
  // ============================================================
  if (method === "GET" && url === "/api/obs/sala10/audiencia/get") {
    const state = await readAudienciaSala10();
    return sendJson(res, 200, state);
  }

  if (method === "POST" && url === "/api/obs/sala10/audiencia/set") {
    try {
      const body = await readBody(req);
      const prev = await readAudienciaSala10();

      const fieldsIn = body.fields || {};
      const fields = {
        fecha: sanitizeOneLine(fieldsIn.fecha),
        juzgado: sanitizeOneLine(fieldsIn.juzgado),
        sala: sanitizeOneLine(fieldsIn.sala),
        expediente: sanitizeOneLine(fieldsIn.expediente),
        caratula: sanitizeOneLine(fieldsIn.caratula),
        imputados: sanitizeOneLine(fieldsIn.imputados),
        tipoProcedimiento: sanitizeOneLine(fieldsIn.tipoProcedimiento),
        sede: sanitizeOneLine(fieldsIn.sede || "Suipacha"),
      };

      const next = {
        ok: true,
        data: {
          visibleBanner:
            typeof body.visibleBanner === "boolean" ? body.visibleBanner : prev.data.visibleBanner,
          visibleOverlay:
            typeof body.visibleOverlay === "boolean" ? body.visibleOverlay : prev.data.visibleOverlay,
          updatedAt: nowIso(),
          fields,
        },
      };

      await writeAudienciaSala10(next);
      return sendJson(res, 200, next);
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: "Body inválido", error: e.message });
    }
  }

  if (method === "POST" && url === "/api/obs/sala10/audiencia/overlay/apply") {
    const state = await readAudienciaSala10();
    const text = buildAudienciaText(state.data.fields || {});
    const r1 = await setSala10OverlayText(text);

    if (!r1.ok) return sendJson(res, 200, r1);

    if (state.data.visibleOverlay === true) {
      const r2 = await setSala10OverlayEnabled(true);
      if (!r2.ok) return sendJson(res, 200, r2);
    }

    return sendJson(res, 200, { ok: true, applied: true });
  }

  if (method === "POST" && url === "/api/obs/sala10/audiencia/overlay/enabled") {
    try {
      const body = await readBody(req);
      if (typeof body.enabled !== "boolean") {
        return sendJson(res, 400, { ok: false, message: "Falta enabled (boolean)" });
      }

      const state = await readAudienciaSala10();
      state.data.visibleOverlay = body.enabled;
      state.data.updatedAt = nowIso();
      await writeAudienciaSala10(state);

      const r = await setSala10OverlayEnabled(body.enabled);
      return sendJson(res, 200, r.ok ? { ok: true, enabled: body.enabled } : r);
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: "Body inválido", error: e.message });
    }
  }

  // ------------------------------
  }
  // RUTA NO ENCONTRADA
  // ------------------------------
  return sendJson(res, 404, { ok: false, message: "Ruta no encontrada" });
});

// -------------------------------------------------------------
// INICIO SERVIDOR
// -------------------------------------------------------------
server.listen(8081, "127.0.0.1", () => {
  console.log("Backend OGAAC iniciado en http://127.0.0.1:8081");
});
