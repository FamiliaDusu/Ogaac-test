/**
 * users-manager.js - Gestion de usuarios OGAAC
 * SECURITY FIX 2026-01-09: Migrado a bcrypt con auto-upgrade de SHA256
 * Persistencia en config/users-roles.json
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const USERS_FILE = path.join(__dirname, "../config/users-roles.json");
const SALT_ROUNDS = 12;

// ============================================
// HASH PASSWORD - BCRYPT (SEGURO)
// ============================================
async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Password requerido");
  }
  if (plaintext.length < 6) {
    throw new Error("Password debe tener al menos 6 caracteres");
  }
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

// ============================================
// VERIFY PASSWORD - Con auto-migracion SHA256 -> bcrypt
// ============================================
async function verifyPassword(username, plaintext) {
  const user = await getUser(username);
  if (!user) return false;
  if (user.enabled === false) return false;

  const hash = user.passwordHash;

  // Detectar tipo de hash
  if (hash.startsWith("$2b$") || hash.startsWith("$2a$")) {
    // Ya es bcrypt - verificar directamente
    return bcrypt.compare(plaintext, hash);
  } else if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
    // SHA256 legacy (64 chars hex) - verificar y AUTO-MIGRAR
    const sha256Hash = crypto.createHash("sha256").update(plaintext).digest("hex");
    if (sha256Hash === hash) {
      // Password correcto - migrar a bcrypt automaticamente
      console.log("[Security] Auto-migrando password a bcrypt para: " + username);
      try {
        const newHash = await hashPassword(plaintext);
        await updateUserHash(username, newHash);
        console.log("[Security] Password migrado exitosamente para: " + username);
      } catch (err) {
        console.error("[Security] Error migrando password para " + username + ":", err);
      }
      return true;
    }
    return false;
  } else {
    console.error("[Security] Formato de hash invalido para usuario: " + username);
    return false;
  }
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
    return { valid: false, error: "Username solo puede contener letras, numeros, . _ -" };
  }

  return { valid: true, username: clean };
}

function validateRole(role) {
  const validRoles = ["admin", "operator", "viewer"];
  if (!validRoles.includes(role)) {
    return { valid: false, error: "Rol invalido. Debe ser: " + validRoles.join(", ") };
  }
  return { valid: true };
}

// ============================================
// READ/WRITE USERS
// ============================================
async function readUsersFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
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

async function listUsers() {
  const data = await readUsersFile();
  return data.users.map(function(u) {
    return {
      username: u.username,
      role: u.role,
      enabled: u.enabled !== false,
      source: u.source || "local",
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      note: u.note || null,
      scope: u.scope || null
    };
  });
}

async function getUser(username) {
  const data = await readUsersFile();
  return data.users.find(function(u) { return u.username === username; }) || null;
}

async function createUser(opts) {
  var username = opts.username;
  var password = opts.password;
  var role = opts.role;
  var note = opts.note;
  var scope = opts.scope;

  var usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return { ok: false, error: usernameValidation.error };
  }

  var roleValidation = validateRole(role);
  if (!roleValidation.valid) {
    return { ok: false, error: roleValidation.error };
  }

  if (!password || password.length < 6) {
    return { ok: false, error: "Password debe tener al menos 6 caracteres" };
  }

  var data = await readUsersFile();

  if (data.users.some(function(u) { return u.username === username; })) {
    return { ok: false, error: "El usuario ya existe" };
  }

  var passwordHash = await hashPassword(password);
  var now = new Date().toISOString();

  data.users.push({
    username: usernameValidation.username,
    passwordHash: passwordHash,
    role: role,
    enabled: true,
    source: "local",
    createdAt: now,
    updatedAt: now,
    note: note || null,
    scope: scope || null
  });

  var result = await writeUsersFile(data);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  console.log("[users-manager] Usuario creado: " + username + " (" + role + ") [bcrypt]");
  return { ok: true, username: username };
}

async function updateUser(username, updates) {
  var data = await readUsersFile();
  var user = data.users.find(function(u) { return u.username === username; });

  if (!user) {
    return { ok: false, error: "Usuario no encontrado" };
  }

  if (updates.password) {
    if (updates.password.length < 6) {
      return { ok: false, error: "Password debe tener al menos 6 caracteres" };
    }
    user.passwordHash = await hashPassword(updates.password);
  }

  if (updates.role !== undefined) {
    var roleValidation = validateRole(updates.role);
    if (!roleValidation.valid) {
      return { ok: false, error: roleValidation.error };
    }
    user.role = updates.role;
  }

  if (updates.enabled !== undefined) {
    user.enabled = !!updates.enabled;
  }

  if (updates.note !== undefined) {
    user.note = updates.note;
  }

  if (updates.scope !== undefined) {
    user.scope = updates.scope;
  }

  user.updatedAt = new Date().toISOString();

  var result = await writeUsersFile(data);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// Funcion interna para actualizar solo el hash (usada en auto-migracion)
async function updateUserHash(username, newHash) {
  var data = await readUsersFile();
  var user = data.users.find(function(u) { return u.username === username; });

  if (!user) return;

  user.passwordHash = newHash;
  user.updatedAt = new Date().toISOString();

  await writeUsersFile(data);
}

async function deleteUser(username) {
  var data = await readUsersFile();
  var initialLength = data.users.length;

  data.users = data.users.filter(function(u) {
    return u.username !== username || u.source === "ad";
  });

  if (data.users.length === initialLength) {
    return { ok: false, error: "Usuario no encontrado o es de Active Directory" };
  }

  var result = await writeUsersFile(data);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  console.log("[users-manager] Usuario eliminado: " + username);
  return { ok: true };
}

module.exports = {
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  validateUsername: validateUsername,
  validateRole: validateRole,
  listUsers: listUsers,
  getUser: getUser,
  createUser: createUser,
  updateUser: updateUser,
  deleteUser: deleteUser
};
