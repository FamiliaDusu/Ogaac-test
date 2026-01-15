# Plan de Escalabilidad - Base de Datos OGAAC
## Sistema Judicial de Streaming

**Fecha:** 2026-01-09
**Version:** 1.0
**Ambiente Analizado:** TEST (/home/sdupero/proyecto-ogaac/ogaac-backend)

---

## 1. DIAGNOSTICO ACTUAL

### 1.1 Tipo de "BD" Detectado

**Sistema actual: Archivos JSON (File-based)**

No hay base de datos relacional. La persistencia se maneja con archivos JSON:

| Archivo | Proposito | Tamano Actual |
|---------|-----------|---------------|
| `config/users-roles.json` | Usuarios y roles | ~1.6 KB (5 usuarios) |
| `config/salas.json` | Config de salas OBS | ~2.7 KB |
| `config/salas.secrets.json` | Passwords OBS | ~69 bytes |
| `logs/audit-*.jsonl` | Logs de auditoria | Variable (rotacion 50MB) |

### 1.2 Schema Documentado (Actual)

```
Archivo: users-roles.json
{
  "users": [
    {
      "username": string (3-32 chars, alphanumerico),
      "passwordHash": string (SHA256 hex, 64 chars),
      "role": "admin" | "operator" | "viewer",
      "enabled": boolean,
      "source": "local" | "ad",
      "createdAt": ISO8601 string,
      "updatedAt": ISO8601 string,
      "note": string | null,
      "scope": {
        "sedes": ["suipacha", "tacuari", ...],
        "salas": { "suipacha": ["sala01", "sala02"], ... }
      } | null
    }
  ]
}

Archivo: salas.json
{
  "suipacha": {
    "sala01": { "ws": "ws://IP:4455", "enabled": bool, "needsSecrets": bool },
    ...
  },
  "tacuari": { ... },
  "balbin": { ... },
  "yrigoyen": { ... },
  "libertad": { ... }
}

Archivo: audit-YYYY-MM-DD.jsonl (JSONL format)
{
  "ts": ISO8601,
  "user": string,
  "role": string,
  "method": "GET" | "POST" | ...,
  "path": string,
  "status": number,
  "ip": string,
  "userAgent": string,
  "durationMs": number,
  "meta": { sede?, sala?, action?, ... }
}
```

### 1.3 Problemas del Sistema Actual

| Problema | Impacto | Severidad |
|----------|---------|-----------|
| Sin transacciones | Race conditions en escrituras concurrentes | ALTO |
| Sin indices | Busquedas O(n) en todos los usuarios | MEDIO |
| Sin backup automatico | Perdida de datos si se corrompe JSON | ALTO |
| Sin relaciones | No se puede auditar cambios de usuarios | MEDIO |
| Escala limitada | >1000 usuarios = lentitud notable | MEDIO |
| Sin queries complejas | Reportes dificiles de implementar | BAJO |

### 1.4 Metricas de Uso Actual

```
Usuarios registrados: 5
Salas configuradas: ~30 (6 sedes)
Requests/dia estimados: ~500-1000
Escrituras/dia: ~50 (logins, cambios config)
Lecturas/dia: ~950
```

---

## 2. ARQUITECTURA PROPUESTA

### Opcion A: SQLite (Recomendada para OGAAC)

**Por que SQLite:**
- Sistema pequeno (<1000 usuarios)
- Single-server deployment
- Sin necesidad de servidor DB separado
- Transacciones ACID
- Migracion simple desde JSON
- Zero configuration

**Stack:**
- SQLite 3.x
- better-sqlite3 (driver Node.js sincrono, mejor performance)
- Migraciones con simple-db-migrate o manual

**Schema propuesto:**

```sql
-- Tabla: usuarios
CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL CHECK(length(username) >= 3),
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'local' CHECK(source IN ('local', 'ad')),
    scope_json TEXT,  -- JSON para flexibilidad
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_usuarios_username ON usuarios(username);
CREATE INDEX idx_usuarios_role ON usuarios(role);
CREATE INDEX idx_usuarios_enabled ON usuarios(enabled);

-- Tabla: salas
CREATE TABLE salas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sede TEXT NOT NULL,
    sala TEXT NOT NULL,
    ws_url TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    needs_secrets INTEGER DEFAULT 0,
    password_encrypted TEXT,  -- Encriptado con key en .env
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sede, sala)
);

CREATE INDEX idx_salas_sede ON salas(sede);
CREATE INDEX idx_salas_enabled ON salas(enabled);

-- Tabla: audit_log
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    user_id INTEGER REFERENCES usuarios(id),
    username TEXT NOT NULL,
    role TEXT,
    method TEXT,
    path TEXT,
    status INTEGER,
    ip TEXT,
    user_agent TEXT,
    duration_ms INTEGER,
    meta_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_username ON audit_log(username);
CREATE INDEX idx_audit_path ON audit_log(path);

-- Tabla: sesiones (para refresh tokens)
CREATE TABLE sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES usuarios(id),
    refresh_token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    revoked INTEGER DEFAULT 0
);

CREATE INDEX idx_sesiones_user ON sesiones(user_id);
CREATE INDEX idx_sesiones_token ON sesiones(refresh_token_hash);
CREATE INDEX idx_sesiones_expires ON sesiones(expires_at);
```

**Cambios en codigo:**

```javascript
// db.js - Nueva capa de datos
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.OGAAC_DB_PATH ||
  path.join(__dirname, '../data/ogaac.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');  // Write-Ahead Logging para concurrencia
db.pragma('foreign_keys = ON');

// Prepared statements para performance
const stmts = {
  getUserByUsername: db.prepare(
    'SELECT * FROM usuarios WHERE username = ? AND enabled = 1'
  ),
  createUser: db.prepare(`
    INSERT INTO usuarios (username, password_hash, role, source, scope_json, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  updateUser: db.prepare(`
    UPDATE usuarios
    SET password_hash = COALESCE(?, password_hash),
        role = COALESCE(?, role),
        enabled = COALESCE(?, enabled),
        scope_json = COALESCE(?, scope_json),
        note = COALESCE(?, note),
        updated_at = datetime('now')
    WHERE username = ?
  `),
  listUsers: db.prepare(
    'SELECT id, username, role, enabled, source, scope_json, note, created_at FROM usuarios ORDER BY username'
  ),
  insertAudit: db.prepare(`
    INSERT INTO audit_log (username, role, method, path, status, ip, user_agent, duration_ms, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
};

module.exports = { db, stmts };
```

**Beneficios:**
- Soporta 10,000+ usuarios sin degradacion
- Transacciones ACID
- Queries SQL para reportes
- Backup simple (copiar archivo .db)
- Sin servidor adicional

**Costo:**
- Tiempo implementacion: 2-3 dias
- Hardware adicional: $0
- Mantenimiento: Minimo

---

### Opcion B: PostgreSQL (Para Escala Mayor)

**Cuando elegir PostgreSQL:**
- Multiples servidores backend
- >10,000 usuarios
- Reportes complejos frecuentes
- Integracion con otros sistemas judiciales

**Stack:**
- PostgreSQL 15+
- pg (node-postgres) con pool
- Sequelize o Prisma (ORM opcional)
- PgBouncer para connection pooling

**Schema PostgreSQL:**

```sql
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    enabled BOOLEAN DEFAULT true,
    source VARCHAR(20) DEFAULT 'local',
    scope JSONB,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usuarios_username ON usuarios(username);
CREATE INDEX idx_usuarios_role ON usuarios(role) WHERE enabled = true;
CREATE INDEX idx_usuarios_scope ON usuarios USING GIN(scope);

-- Particionamiento para audit_log (por mes)
CREATE TABLE audit_log (
    id BIGSERIAL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    user_id INTEGER REFERENCES usuarios(id),
    username VARCHAR(32) NOT NULL,
    role VARCHAR(20),
    method VARCHAR(10),
    path VARCHAR(512),
    status SMALLINT,
    ip INET,
    user_agent TEXT,
    duration_ms INTEGER,
    meta JSONB,
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- Crear particiones automaticamente
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

**Conexion con pool:**

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ogaac',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,                    // Max connections en pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Health check
pool.on('error', (err) => {
  console.error('Pool error:', err);
});

module.exports = pool;
```

**Costo:**
- Tiempo: 1-2 semanas
- Hardware: Servidor dedicado o managed DB (~$50-200/mes)
- Mantenimiento: Medio (backups, updates, monitoring)

---

## 3. PLAN DE MIGRACION - SQLite (14 Dias)

### Dia 1-2: Preparacion

```bash
# 1. Backup actual
cd /home/sdupero/proyecto-ogaac/ogaac-backend
mkdir -p backups/pre-migration-$(date +%Y%m%d)
cp -r config/ backups/pre-migration-$(date +%Y%m%d)/
cp -r logs/ backups/pre-migration-$(date +%Y%m%d)/

# 2. Instalar dependencias
npm install better-sqlite3 --save

# 3. Crear estructura de directorios
mkdir -p data
touch data/.gitkeep
echo "data/*.db" >> .gitignore
```

### Dia 3-4: Crear Schema y Capa de Datos

```javascript
// scripts/init-db.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ogaac.db');
const db = new Database(DB_PATH);

// Crear tablas
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'local',
    scope_json TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS salas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sede TEXT NOT NULL,
    sala TEXT NOT NULL,
    ws_url TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    needs_secrets INTEGER DEFAULT 0,
    password_encrypted TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sede, sala)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    username TEXT NOT NULL,
    role TEXT,
    method TEXT,
    path TEXT,
    status INTEGER,
    ip TEXT,
    user_agent TEXT,
    duration_ms INTEGER,
    meta_json TEXT
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
  );

  -- Indices
  CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
  CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones(refresh_token_hash);
`);

console.log('Database initialized at:', DB_PATH);
db.close();
```

### Dia 5-6: Script de Migracion

```javascript
// scripts/migrate-json-to-sqlite.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ogaac.db');
const USERS_JSON = path.join(__dirname, '../config/users-roles.json');
const SALAS_JSON = path.join(__dirname, '../config/salas.json');

const db = new Database(DB_PATH);

// Migrar usuarios
console.log('Migrando usuarios...');
const usersData = JSON.parse(fs.readFileSync(USERS_JSON, 'utf-8'));

const insertUser = db.prepare(`
  INSERT OR REPLACE INTO usuarios
  (username, password_hash, role, enabled, source, scope_json, note, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const migrateUsers = db.transaction((users) => {
  for (const user of users) {
    insertUser.run(
      user.username,
      user.passwordHash,
      user.role,
      user.enabled ? 1 : 0,
      user.source || 'local',
      user.scope ? JSON.stringify(user.scope) : null,
      user.note,
      user.createdAt || new Date().toISOString(),
      user.updatedAt || new Date().toISOString()
    );
    console.log('  + Usuario:', user.username);
  }
});

migrateUsers(usersData.users || []);

// Migrar salas
console.log('Migrando salas...');
const salasData = JSON.parse(fs.readFileSync(SALAS_JSON, 'utf-8'));

const insertSala = db.prepare(`
  INSERT OR REPLACE INTO salas
  (sede, sala, ws_url, enabled, needs_secrets)
  VALUES (?, ?, ?, ?, ?)
`);

const migrateSalas = db.transaction((data) => {
  for (const [sede, salas] of Object.entries(data)) {
    for (const [sala, config] of Object.entries(salas)) {
      insertSala.run(
        sede,
        sala,
        config.ws || '',
        config.enabled ? 1 : 0,
        config.needsSecrets ? 1 : 0
      );
      console.log('  + Sala:', sede, '/', sala);
    }
  }
});

migrateSalas(salasData);

// Verificar
const userCount = db.prepare('SELECT COUNT(*) as count FROM usuarios').get();
const salaCount = db.prepare('SELECT COUNT(*) as count FROM salas').get();

console.log('\\nMigracion completada:');
console.log('  Usuarios:', userCount.count);
console.log('  Salas:', salaCount.count);

db.close();
```

### Dia 7-8: Actualizar users-manager.js

```javascript
// lib/users-manager-sqlite.js
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = process.env.OGAAC_DB_PATH ||
  path.join(__dirname, '../data/ogaac.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const SALT_ROUNDS = 12;

// Prepared statements
const stmts = {
  getUser: db.prepare('SELECT * FROM usuarios WHERE username = ?'),
  getUserEnabled: db.prepare('SELECT * FROM usuarios WHERE username = ? AND enabled = 1'),
  listUsers: db.prepare('SELECT id, username, role, enabled, source, scope_json, note, created_at, updated_at FROM usuarios ORDER BY username'),
  createUser: db.prepare(`
    INSERT INTO usuarios (username, password_hash, role, enabled, source, scope_json, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateUser: db.prepare(`
    UPDATE usuarios SET
      password_hash = COALESCE(?, password_hash),
      role = COALESCE(?, role),
      enabled = COALESCE(?, enabled),
      scope_json = COALESCE(?, scope_json),
      note = COALESCE(?, note),
      updated_at = datetime('now')
    WHERE username = ?
  `),
  deleteUser: db.prepare('DELETE FROM usuarios WHERE username = ? AND source = "local"'),
};

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function verifyPassword(username, plaintext) {
  const user = stmts.getUserEnabled.get(username);
  if (!user) return false;
  return bcrypt.compare(plaintext, user.password_hash);
}

async function getUser(username) {
  const row = stmts.getUser.get(username);
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    enabled: row.enabled === 1,
    source: row.source,
    scope: row.scope_json ? JSON.parse(row.scope_json) : null,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listUsers() {
  return stmts.listUsers.all().map(row => ({
    username: row.username,
    role: row.role,
    enabled: row.enabled === 1,
    source: row.source,
    scope: row.scope_json ? JSON.parse(row.scope_json) : null,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function createUser({ username, password, role, note, scope }) {
  const hash = await hashPassword(password);
  try {
    stmts.createUser.run(
      username,
      hash,
      role,
      1,
      'local',
      scope ? JSON.stringify(scope) : null,
      note || null
    );
    return { ok: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, error: 'Usuario ya existe' };
    }
    throw err;
  }
}

async function updateUser(username, updates) {
  const hash = updates.password ? await hashPassword(updates.password) : null;
  const result = stmts.updateUser.run(
    hash,
    updates.role || null,
    updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : null,
    updates.scope !== undefined ? JSON.stringify(updates.scope) : null,
    updates.note !== undefined ? updates.note : null,
    username
  );
  return { ok: result.changes > 0 };
}

async function deleteUser(username) {
  const result = stmts.deleteUser.run(username);
  return { ok: result.changes > 0 };
}

module.exports = {
  hashPassword,
  verifyPassword,
  getUser,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
```

### Dia 9-10: Actualizar audit.js

```javascript
// lib/audit-sqlite.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.OGAAC_DB_PATH ||
  path.join(__dirname, '../data/ogaac.db');

const db = new Database(DB_PATH);

const insertAudit = db.prepare(`
  INSERT INTO audit_log (username, role, method, path, status, ip, user_agent, duration_ms, meta_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const queryAudit = db.prepare(`
  SELECT * FROM audit_log
  WHERE ts >= ? AND ts < ?
  ORDER BY ts DESC
  LIMIT ?
`);

function auditLog(entry) {
  try {
    insertAudit.run(
      entry.user || 'anonymous',
      entry.role || null,
      entry.method || null,
      entry.path || null,
      entry.status || null,
      entry.ip || null,
      entry.userAgent || null,
      entry.durationMs || null,
      entry.meta ? JSON.stringify(entry.meta) : null
    );
  } catch (err) {
    console.error('[audit-sqlite] Error:', err);
  }
}

function readAuditLog(date, limit = 1000) {
  const startDate = date || new Date().toISOString().split('T')[0];
  const endDate = new Date(new Date(startDate).getTime() + 86400000)
    .toISOString().split('T')[0];

  return queryAudit.all(startDate, endDate, limit).map(row => ({
    ...row,
    meta: row.meta_json ? JSON.parse(row.meta_json) : null,
  }));
}

module.exports = { auditLog, readAuditLog };
```

### Dia 11-12: Testing

```bash
# Test de migracion
cd /home/sdupero/proyecto-ogaac/ogaac-backend
node scripts/init-db.js
node scripts/migrate-json-to-sqlite.js

# Verificar datos
sqlite3 data/ogaac.db "SELECT username, role FROM usuarios;"
sqlite3 data/ogaac.db "SELECT sede, sala FROM salas WHERE enabled = 1;"

# Test de performance
node -e "
const db = require('better-sqlite3')('data/ogaac.db');
console.time('query');
for (let i = 0; i < 1000; i++) {
  db.prepare('SELECT * FROM usuarios WHERE username = ?').get('sdupero');
}
console.timeEnd('query');
"
# Esperado: < 100ms para 1000 queries
```

### Dia 13-14: Deploy y Rollback Plan

```bash
# 1. Backup final pre-deploy
cp -r /home/sdupero/proyecto-ogaac/ogaac-backend /home/sdupero/ogaac-backup-$(date +%Y%m%d)

# 2. Deploy
cd /home/sdupero/proyecto-ogaac/ogaac-backend
git add .
git commit -m "feat: migrate from JSON to SQLite storage"

# 3. Restart backend
pm2 restart ogaac-backend

# 4. Verificar logs
pm2 logs ogaac-backend --lines 50

# ROLLBACK (si hay problemas):
# 1. Revertir codigo
git checkout HEAD~1 -- lib/users-manager.js lib/audit.js

# 2. Restart
pm2 restart ogaac-backend

# 3. JSON files siguen intactos como fallback
```

---

## 4. QUERIES OPTIMIZADAS

### Login de usuario

**ANTES (JSON):**
```javascript
// Lee todo el archivo, busca en array
const users = JSON.parse(fs.readFileSync(USERS_FILE));
const user = users.users.find(u => u.username === username);
// Tiempo: ~5-10ms (escala O(n))
```

**DESPUES (SQLite):**
```javascript
// Prepared statement con indice
const user = stmts.getUserEnabled.get(username);
// Tiempo: <1ms (escala O(1) con indice)
```

### Listar usuarios por rol

**ANTES:** No soportado eficientemente
**DESPUES:**
```sql
SELECT * FROM usuarios WHERE role = ? AND enabled = 1 ORDER BY username;
-- Con indice parcial: <1ms
```

### Buscar en audit log

**ANTES (JSONL):**
```javascript
// Leer archivo linea por linea, filtrar
// Tiempo: 100-500ms para 10K entries
```

**DESPUES (SQLite):**
```sql
SELECT * FROM audit_log
WHERE ts BETWEEN '2026-01-09' AND '2026-01-10'
  AND username = 'sdupero'
ORDER BY ts DESC
LIMIT 100;
-- Con indice: <10ms
```

---

## 5. MONITOREO Y ALERTAS

### Health Check con DB

```javascript
// Agregar a /health endpoint
app.get('/health', (req, res) => {
  try {
    const dbCheck = db.prepare('SELECT 1').get();
    const userCount = db.prepare('SELECT COUNT(*) as c FROM usuarios').get();

    res.json({
      ok: true,
      service: 'ogaac-backend',
      db: {
        status: 'connected',
        users: userCount.c,
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Database error',
    });
  }
});
```

### Metricas SQLite

```javascript
// Agregar endpoint /api/admin/db-stats (solo admin)
const dbStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM usuarios) as total_users,
    (SELECT COUNT(*) FROM usuarios WHERE enabled = 1) as active_users,
    (SELECT COUNT(*) FROM audit_log) as audit_entries,
    (SELECT COUNT(*) FROM sesiones WHERE revoked = 0) as active_sessions
`).get();
```

---

## 6. BACKUP Y RECOVERY

### Backup Automatico

```bash
# /home/sdupero/scripts/backup-ogaac-db.sh
#!/bin/bash
BACKUP_DIR="/home/sdupero/ogaac-backups/db"
DB_PATH="/home/sdupero/proyecto-ogaac/ogaac-backend/data/ogaac.db"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# SQLite online backup (safe while running)
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/ogaac_$DATE.db'"

# Comprimir
gzip $BACKUP_DIR/ogaac_$DATE.db

# Mantener solo ultimos 30 dias
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: ogaac_$DATE.db.gz"
```

```bash
# Agregar a crontab
0 3 * * * /home/sdupero/scripts/backup-ogaac-db.sh >> /var/log/ogaac/backup.log 2>&1
```

### Recovery

```bash
# Restaurar desde backup
gunzip -c /home/sdupero/ogaac-backups/db/ogaac_20260109_030000.db.gz > /tmp/restore.db

# Verificar integridad
sqlite3 /tmp/restore.db "PRAGMA integrity_check;"

# Si OK, reemplazar (con backend detenido)
pm2 stop ogaac-backend
cp /tmp/restore.db /home/sdupero/proyecto-ogaac/ogaac-backend/data/ogaac.db
pm2 start ogaac-backend
```

---

## 7. COSTOS

| Item | Actual | Con SQLite | Con PostgreSQL |
|------|--------|------------|----------------|
| Storage | JSON files | +10MB max | +DB server |
| RAM | ~85MB | ~100MB | +2GB (server) |
| CPU | Bajo | Bajo | Medio |
| Backup | Manual | Automatico | Automatico |
| Tiempo impl | - | 2-3 dias | 1-2 semanas |
| Costo mensual | $0 | $0 | ~$50-200 |

---

## 8. RECOMENDACION FINAL

**Para OGAAC actual: Implementar SQLite (Opcion A)**

**Razones:**
1. Sistema pequeno (<100 usuarios proyectados)
2. Single-server deployment
3. Minima complejidad operativa
4. Transacciones ACID sin infraestructura adicional
5. Migracion simple desde JSON
6. Zero costo adicional

**Timeline sugerido:**
- Sprint 1 (1 semana): Implementar SQLite + migrar usuarios
- Sprint 2 (1 semana): Migrar audit log + testing
- Sprint 3 (si necesario): Agregar PostgreSQL si escala

**ROI:**
- Elimina race conditions en escrituras concurrentes
- Queries 10-100x mas rapidas
- Backup automatico confiable
- Base para futuras features (reportes, busquedas avanzadas)

---

## ANEXO: Checklist de Implementacion

- [ ] Instalar better-sqlite3
- [ ] Crear script init-db.js
- [ ] Crear script migrate-json-to-sqlite.js
- [ ] Actualizar lib/users-manager.js
- [ ] Actualizar lib/audit.js
- [ ] Agregar DB health check a /health
- [ ] Configurar backup automatico
- [ ] Testing en ambiente test
- [ ] Documentar rollback procedure
- [ ] Deploy a produccion
- [ ] Verificar logs 24h post-deploy
- [ ] Archivar JSON files (no eliminar)
