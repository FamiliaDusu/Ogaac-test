# OGAAC Backend: Auditoría y Scope

Documentación de los sistemas de auditoría de acciones y permisos finos por sede/sala.

---

## 1. AUDITORÍA DE ACCIONES

### Ubicación y formato

**Archivos**: `ogaac-backend/logs/audit-YYYY-MM-DD.jsonl`

Formato: **JSONL** (JSON Lines) - un evento JSON por línea.

### Campos del evento

Cada línea contiene un objeto JSON con los siguientes campos:

```json
{
  "ts": "2026-01-09T14:23:45.123Z",
  "user": "sdupero",
  "role": "admin",
  "method": "POST",
  "path": "/api/admin/users",
  "status": 200,
  "ip": "127.0.0.1",
  "userAgent": "curl/7.88.1",
  "durationMs": 12,
  "meta": {
    "action": "create_user",
    "targetUser": "operator01",
    "targetRole": "operator"
  }
}
```

**Campos principales**:
- `ts`: Timestamp ISO 8601
- `user`: Username del usuario autenticado
- `role`: Rol del usuario (admin/operator/viewer)
- `method`: Método HTTP (GET/POST/PUT/DELETE)
- `path`: Ruta del endpoint (sin query params)
- `status`: Código HTTP de respuesta
- `ip`: IP del cliente (x-real-ip, x-forwarded-for, o remoteAddress)
- `userAgent`: User-Agent del cliente
- `durationMs`: Duración del request en milisegundos
- `meta`: Objeto opcional con metadata específica (action, targetUser, sede, sala, etc.)

### Rotación secundaria por tamaño

**Límite**: 50 MB por archivo

Cuando `audit-YYYY-MM-DD.jsonl` supera 50 MB:
- Se crea `audit-YYYY-MM-DD_2.jsonl`
- Si `_2` se llena, se crea `_3`, y así hasta `_20`
- Si se alcanza `_20`, se sigue escribiendo en `_20` (con warning)

**Ejemplo de archivos rotados**:
```
logs/
  audit-2026-01-09.jsonl       (51 MB - lleno)
  audit-2026-01-09_2.jsonl     (48 MB - activo)
  audit-2026-01-10.jsonl       (2 MB)
```

### Endpoint de consulta: GET /api/admin/audit

**Requiere**: Rol `admin`

**Parámetros (query string)**:

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `date` | string | hoy | Fecha en formato YYYY-MM-DD |
| `limit` | int | 200 | Máximo de eventos (hard cap: 500) |
| `user` | string | - | Filtrar por username exacto (case-insensitive) |
| `action` | string | - | Filtrar por meta.action exacto (case-insensitive) |
| `contains` | string | - | Filtrar por substring en path (case-insensitive) |

**Validaciones**:
- `date`: Formato estricto YYYY-MM-DD, solo dígitos y guiones
- `limit`: Entero entre 1 y 500
- `user`, `action`, `contains`: Máximo 128 caracteres c/u

**Respuesta**:

```json
{
  "ok": true,
  "date": "2026-01-09",
  "count": 15,
  "limit": 200,
  "filters": {
    "user": "sdupero",
    "action": "create_user"
  },
  "events": [
    { /* evento más reciente */ },
    { /* ... */ }
  ],
  "availableDates": ["2026-01-09", "2026-01-08", ...]
}
```

**Eventos ordenados**: Más recientes primero.

### Ejemplos curl

**Consultar auditoría de hoy**:
```bash
curl "http://localhost:8081/api/admin/audit" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Consultar fecha específica con límite**:
```bash
curl "http://localhost:8081/api/admin/audit?date=2026-01-09&limit=50" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Filtrar por usuario**:
```bash
curl "http://localhost:8081/api/admin/audit?user=operator01" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Filtrar por acción**:
```bash
curl "http://localhost:8081/api/admin/audit?action=create_user" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Filtrar por path (contains)**:
```bash
curl "http://localhost:8081/api/admin/audit?contains=/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Combinar filtros**:
```bash
curl "http://localhost:8081/api/admin/audit?date=2026-01-09&user=sdupero&action=delete_user&limit=100" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 2. SCOPE (Permisos finos por sede/sala)

### Estructura en users-roles.json

Campo opcional `scope` por usuario:

```json
{
  "username": "operator_suipacha",
  "passwordHash": "...",
  "role": "operator",
  "scope": {
    "sedes": ["suipacha", "balbin"],
    "salas": {
      "suipacha": ["sala01", "sala10"],
      "balbin": ["sala02"]
    }
  }
}
```

**Estructura del scope**:
- `sedes`: Array de nombres de sedes permitidas (lowercase)
- `salas`: Objeto con clave=sede, valor=array de salas permitidas (lowercase)

### Reglas de acceso

1. **Sin scope** (`scope: null` o ausente):
   - Acceso TOTAL a todas las sedes y salas (retrocompatible)

2. **Con scope definido**:
   - Solo puede acceder a sedes listadas en `scope.sedes`
   - Si `scope.salas[sede]` existe, solo puede acceder a esas salas de esa sede
   - Si `scope.salas[sede]` NO existe pero la sede está en `scope.sedes`, puede acceder a todas las salas de esa sede

3. **Validación**:
   - Backend valida scope en TODAS las rutas `/api/obs/:sede/:sala/*`
   - Si el usuario intenta acceder fuera de su scope → `403 SCOPE_DENIED`

### Códigos de error

**403 SCOPE_DENIED**:
```json
{
  "ok": false,
  "code": "SCOPE_DENIED",
  "message": "No tienes permiso para acceder a suipacha/sala02",
  "sede": "suipacha",
  "sala": "sala02"
}
```

### Endpoints afectados por scope

**Filtrado automático**:
- `GET /api/obs/config` → Retorna solo salas dentro del scope del usuario

**Validación obligatoria** (403 si fuera de scope):
- `GET /api/obs/:sede/:sala/status`
- `POST /api/obs/:sede/:sala/start-stream`
- `POST /api/obs/:sede/:sala/stop-stream`
- `POST /api/obs/:sede/:sala/start-recording`
- `POST /api/obs/:sede/:sala/stop-recording`
- `POST /api/obs/:sede/:sala/set-scene`
- Todas las rutas `/api/obs/:sede/:sala/*`

### Frontend

El módulo `auth-rbac.js` expone:

```javascript
// Obtener scope del usuario actual
const scope = window.OGAAC_RBAC.getScope();

// Verificar acceso a sede/sala
if (window.OGAAC_RBAC.hasAccessToSala('suipacha', 'sala01')) {
  // Usuario tiene acceso
}

// Filtrar array de salas
const filteredSalas = window.OGAAC_RBAC.filterSalasByScope(allSalas);
```

**IMPORTANTE**: El backend YA filtra `/api/obs/config`, así que el frontend recibe solo las salas permitidas automáticamente.

---

## 3. REGLA DE ORO: SCOPE en endpoints OBS

### ⚠️ GUARDRAIL CRÍTICO

**TODAS** las rutas OBS que usan `:sede/:sala` **DEBEN** pasar por el handler dinámico en `server.js` y validar scope con `hasAccessToSala()` **ANTES** de ejecutar cualquier acción.

**Ubicación en código**: `server.js` líneas ~1046-1090

```javascript
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
```

**Si agrega un nuevo endpoint OBS**:
1. Agregarlo dentro del bloque `if (__dyn)`
2. La validación de scope ya está hecha antes de llegar a los handlers
3. NO saltear la validación con endpoints fuera del handler dinámico

---

## 4. CHECKLIST DE PRUEBAS

### ✅ Test 1: Auditoría básica
```bash
# Crear usuario (genera evento audit)
curl -X POST http://localhost:8081/api/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123","role":"viewer"}'

# Leer auditoría de hoy
curl "http://localhost:8081/api/admin/audit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### ✅ Test 2: Filtros de auditoría
```bash
# Filtrar por usuario
curl "http://localhost:8081/api/admin/audit?user=sdupero" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.count'

# Filtrar por acción
curl "http://localhost:8081/api/admin/audit?action=create_user" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.count'
```

### ✅ Test 3: Scope - usuario limitado
```bash
# Crear usuario con scope limitado
curl -X POST http://localhost:8081/api/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator_limited",
    "password": "test123",
    "role": "operator",
    "scope": {
      "sedes": ["suipacha"],
      "salas": {"suipacha": ["sala01"]}
    }
  }'

# Login como usuario limitado
curl -X POST http://localhost:8081/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator_limited","password":"test123"}' \
  > /tmp/limited_token.json

LIMITED_TOKEN=$(jq -r '.token' /tmp/limited_token.json)

# Verificar scope en /api/me
curl http://localhost:8081/api/me \
  -H "Authorization: Bearer $LIMITED_TOKEN" | jq '.scope'
```

### ✅ Test 4: Validar 403 SCOPE_DENIED
```bash
# Intentar acceder a sala fuera de scope (debe retornar 403)
curl -i http://localhost:8081/api/obs/balbin/sala10/status \
  -H "Authorization: Bearer $LIMITED_TOKEN"

# Respuesta esperada: HTTP 403 con code "SCOPE_DENIED"
```

### ✅ Test 5: Config filtrado por scope
```bash
# Usuario limitado solo ve sus salas
curl http://localhost:8081/api/obs/config \
  -H "Authorization: Bearer $LIMITED_TOKEN" | jq '.salas | length'

# Admin ve todas
curl http://localhost:8081/api/obs/config \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.salas | length'
```

---

## 5. MANTENIMIENTO

### Limpieza de logs antiguos

Los archivos de auditoría NO se rotan automáticamente por fecha. Para limpiar logs antiguos:

```bash
# Listar archivos de audit
ls -lh ogaac-backend/logs/audit-*.jsonl

# Eliminar logs de hace más de 90 días (ejemplo)
find ogaac-backend/logs -name "audit-*.jsonl" -mtime +90 -delete
```

### Monitoreo de tamaño

```bash
# Ver tamaño total de logs
du -sh ogaac-backend/logs/

# Ver archivos más grandes
ls -lhS ogaac-backend/logs/audit-*.jsonl | head
```

---

## 6. TROUBLESHOOTING

### Problema: Auditoría no registra eventos

**Verificar**:
1. ¿El usuario está autenticado? (req._auditUser debe existir)
2. ¿Existe el directorio `logs/`?
3. ¿Permisos de escritura en `logs/`?
4. Revisar console.error en backend

### Problema: 403 SCOPE_DENIED inesperado

**Verificar**:
1. Ver scope del usuario: `GET /api/me`
2. Nombres de sede/sala son case-insensitive (se comparan en lowercase)
3. Verificar estructura exacta de scope en `users-roles.json`

### Problema: Rotación no funciona

**Verificar**:
1. Tamaño del archivo: `ls -lh logs/audit-YYYY-MM-DD.jsonl`
2. ¿Superó 50 MB?
3. ¿Existen archivos `_2`, `_3`?
4. Revisar logs del backend para warnings

---

**Última actualización**: 2026-01-09
