/**
 * users-manager.js - Gestión de usuarios OGAAC
 * Persistencia en config/users-roles.json
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const USERS_FILE = path.join(__dirname, "../config/users-roles.json");

// ============================================
// HASH PASSWORD (SHA256)
// ============================================
function hashPassword(plaintext) {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

// ============================================
// VALIDACIONES
// ============================================
function validateUsername(username) {
  if (!username || typeof username !== "string") {
    return { valid: false, error: "Username requerido" };
  }

  const clean = username.trim();

  if (clean.length < 3 || clean.length > 32) {
    return { valid: false, error: "Username debe tener 3-32 caracteres" };
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    return { valid: false, error: "Username solo puede contener letras, números, . _ -" };
  }

  return { valid: true, username: clean };
}

function validateRole(role) {
  const validRoles = ["admin", "operator", "viewer"];
  if (!validRoles.includes(role)) {
    return { valid: false, error: `Rol inválido. Debe ser: ${validRoles.join(", ")}` };
  }
  return { valid: true };
}

// ============================================
// READ/WRITE USERS
// ============================================
async function readUsersFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      // Crear archivo vacío inicial
      const initial = { users: [] };
      await writeUsersFile(initial);
      return initial;
    }

    const raw = await fsp.readFile(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[users-manager] Error leyendo users-roles.json:", err);
    return { users: [] };
  }
}

async function writeUsersFile(data) {
  try {
    const tmpFile = USERS_FILE + ".tmp";
    await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    await fsp.rename(tmpFile, USERS_FILE);
    return { ok: true };
  } catch (err) {
    console.error("[users-manager] Error escribiendo users-roles.json:", err);
    return { ok: false, error: err.message };
  }
}

// ============================================
// CRUD OPERATIONS
// ============================================

/**
 * Listar todos los usuarios (sin passwords)
 */
async function listUsers() {
  const data = await readUsersFile();
  return data.users.map((u) => ({
    username: u.username,
    role: u.role,
    enabled: u.enabled !== false,
    source: u.source || "local",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    note: u.note || null,
    scope: u.scope || null, // SCOPE: permisos finos por sede/sala (opcional)
  }));
}

/**
 * Obtener usuario por username (con passwordHash)
 */
async function getUser(username) {
  const data = await readUsersFile();
  return data.users.find((u) => u.username === username);
}

/**
 * Crear nuevo usuario local
 */
async function createUser({ username, password, role, note, scope }) {
  // Validar username
  const vUser = validateUsername(username);
  if (!vUser.valid) return { ok: false, error: vUser.error };

  const cleanUsername = vUser.username;

  // Validar rol
  const vRole = validateRole(role);
  if (!vRole.valid) return { ok: false, error: vRole.error };

  // Validar password
  if (!password || password.length < 8) {
    return { ok: false, error: "Password debe tener al menos 8 caracteres" };
  }

  // Leer usuarios actuales
  const data = await readUsersFile();

  // Verificar que no exista
  if (data.users.find((u) => u.username === cleanUsername)) {
    return { ok: false, error: "Usuario ya existe" };
  }

  // Crear usuario
  const now = new Date().toISOString();
  const newUser = {
    username: cleanUsername,
    passwordHash: hashPassword(password),
    role,
    enabled: true,
    source: "local",
    createdAt: now,
    updatedAt: now,
    note: note || null,
    scope: scope || null, // SCOPE: opcional (null = acceso total)
  };

  data.users.push(newUser);

  // Guardar
  const writeResult = await writeUsersFile(data);
  if (!writeResult.ok) return writeResult;

  return { ok: true, user: { username: cleanUsername, role, enabled: true, source: "local" } };
}

/**
 * Actualizar usuario (rol, enabled, password, note)
 */
async function updateUser(username, updates) {
  const data = await readUsersFile();
  const index = data.users.findIndex((u) => u.username === username);

  if (index === -1) {
    return { ok: false, error: "Usuario no encontrado" };
  }

  const user = data.users[index];

  // No permitir editar usuarios AD
  if (user.source === "ad") {
    return { ok: false, error: "No se pueden editar usuarios de Active Directory" };
  }

  // Validar rol si viene
  if (updates.role !== undefined) {
    const vRole = validateRole(updates.role);
    if (!vRole.valid) return { ok: false, error: vRole.error };
    user.role = updates.role;
  }

  // Enabled
  if (updates.enabled !== undefined) {
    user.enabled = Boolean(updates.enabled);
  }

  // Password (opcional)
  if (updates.password) {
    if (updates.password.length < 8) {
      return { ok: false, error: "Password debe tener al menos 8 caracteres" };
    }
    user.passwordHash = hashPassword(updates.password);
  }

  // Note
  if (updates.note !== undefined) {
    user.note = updates.note || null;
  }

  // Scope (PERMISOS FINOS por sede/sala)
  if (updates.scope !== undefined) {
    user.scope = updates.scope || null;
  }

  user.updatedAt = new Date().toISOString();

  // Guardar
  const writeResult = await writeUsersFile(data);
  if (!writeResult.ok) return writeResult;

  return { ok: true, user: { username, role: user.role, enabled: user.enabled, source: user.source } };
}

/**
 * Eliminar usuario
 */
async function deleteUser(username) {
  const data = await readUsersFile();
  const index = data.users.findIndex((u) => u.username === username);

  if (index === -1) {
    return { ok: false, error: "Usuario no encontrado" };
  }

  const user = data.users[index];

  // No permitir borrar usuarios AD
  if (user.source === "ad") {
    return { ok: false, error: "No se pueden eliminar usuarios de Active Directory" };
  }

  // Eliminar
  data.users.splice(index, 1);

  // Guardar
  const writeResult = await writeUsersFile(data);
  if (!writeResult.ok) return writeResult;

  return { ok: true, message: `Usuario ${username} eliminado` };
}

/**
 * Verificar password (para login)
 */
async function verifyPassword(username, password) {
  const user = await getUser(username);
  if (!user) return false;
  if (!user.enabled) return false;

  const hash = hashPassword(password);
  return hash === user.passwordHash;
}

module.exports = {
  hashPassword,
  validateUsername,
  validateRole,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  verifyPassword,
};
