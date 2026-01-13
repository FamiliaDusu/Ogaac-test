# AUDITORIA OGAAC - Sistema Judicial de Streaming
## Fallas Detectadas y Recomendaciones

**Fecha:** 2026-01-09
**Auditor:** Claude Code
**Ambiente:** TEST (/var/www/ogaac-test, /home/sdupero/proyecto-ogaac/ogaac-backend)
**Stack:** Node.js + Nginx + HLS + OBS WebSocket

---

## CRITICO - Arreglar HOY

### 1. JWT Secret con Fallback Hardcodeado
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/server.js:22`
- **Problema:** `const SECRET = process.env.OGAAC_JWT_SECRET || "CHANGE_ME";` - Si la variable de entorno no esta definida, usa un secret predecible.
- **Riesgo:** Un atacante puede generar tokens JWT validos y obtener acceso admin al sistema judicial.
- **Fix:**
```javascript
// server.js linea 22
const SECRET = process.env.OGAAC_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("FATAL: OGAAC_JWT_SECRET no definido o muy corto (minimo 32 chars)");
  process.exit(1);
}
```
- **Test:** Verificar que el .env tiene OGAAC_JWT_SECRET con 32+ caracteres
- **Tiempo:** 30 min

---

### 2. Password de OBS Expuesto en Archivo de Configuracion
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/config/salas.secrets.json`
- **Problema:** Password "CocaCola1996" en texto plano, accesible por cualquier usuario del sistema.
- **Riesgo:** Acceso no autorizado a OBS de sala 10, manipulacion de transmisiones judiciales.
- **Fix:**
```bash
# Cambiar permisos del archivo
chmod 600 /home/sdupero/proyecto-ogaac/ogaac-backend/config/salas.secrets.json
chmod 600 /home/sdupero/proyecto-ogaac/.env
```
- **Test:** Verificar que OBS sigue conectando despues del cambio
- **Tiempo:** 30 min

---

### 3. Passwords Hasheados con SHA256 (Inseguro)
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/lib/users-manager.js:18`
- **Problema:** `crypto.createHash("sha256")` - SHA256 es rapido y vulnerable a ataques de diccionario.
- **Riesgo:** Si se filtra users-roles.json, las passwords pueden crackearse en minutos.
- **Fix:**
```bash
cd /home/sdupero/proyecto-ogaac/ogaac-backend
npm install bcrypt --save
```
```javascript
// users-manager.js - Reemplazar hashPassword
const bcrypt = require("bcrypt");
const SALT_ROUNDS = 12;

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function verifyPassword(username, plaintext) {
  const user = await getUser(username);
  if (!user) return false;
  return bcrypt.compare(plaintext, user.passwordHash);
}
```
- **Test:** Crear usuario nuevo, verificar que hash comienza con "$2b$"
- **Tiempo:** 2 horas

---

### 4. Sin Refresh Token - Sesion de 8 Horas Sin Renovacion
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/server.js:1563`
- **Problema:** Token con `expiresIn: "8h"` sin mecanismo de refresh. Token robado = acceso por 8 horas.
- **Riesgo:** Token robado da acceso prolongado; sin forma de revocar sesiones activas.
- **Fix:** Implementar dual-token (access 15min + refresh 7d en HttpOnly cookie)
- **Tiempo:** 4 horas

---

### 5. Token JWT en localStorage (Vulnerable a XSS)
- **Ubicacion:** `/var/www/ogaac-test/html/js/auth.js:75`
- **Problema:** `localStorage.setItem("ogaac_token", data.token);` - Accesible por cualquier JavaScript.
- **Riesgo:** Cualquier XSS puede robar el token y obtener acceso completo.
- **Fix:** Usar HttpOnly cookie en lugar de localStorage
- **Tiempo:** 3 horas

---

### 6. Sin HTTPS en Ambiente de Test
- **Ubicacion:** `/etc/nginx/sites-enabled/ogaac-test.conf`
- **Problema:** Solo escucha en puerto 8080 HTTP plano, sin SSL/TLS.
- **Riesgo:** Credenciales y tokens viajan en texto plano por la red.
- **Fix:** Configurar SSL con certificado (auto-firmado para test o Let's Encrypt)
- **Tiempo:** 2 horas

---

### 7. Sin Rate Limiting en Endpoints de Backend
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/server.js`
- **Problema:** Nginx tiene rate limit para login (5r/m) pero backend Node.js no tiene proteccion.
- **Riesgo:** Bypass de nginx rate limit, brute force en API, DoS.
- **Fix:** Implementar rate limiting con express-rate-limit o similar
- **Tiempo:** 2 horas

---

### 8. XSS Potencial en Panel Admin
- **Ubicacion:** `/var/www/ogaac-test/html/pages/operador/admin/admin.js:155`
- **Problema:** innerHTML usado en varios lugares. Aunque hay escapeHtml, verificar cobertura completa.
- **Riesgo:** Si algun campo no pasa por escapeHtml, XSS posible.
- **Fix:** Agregar Content-Security-Policy header y verificar sanitizacion
- **Tiempo:** 2 horas

---

## IMPORTANTE - Sprint Actual

### 9. Archivos .BAK Expuestos (76 archivos)
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/`
- **Problema:** Backups con codigo y posibles secrets anteriores accesibles.
- **Fix:**
```bash
mkdir -p /home/sdupero/ogaac-backups
mv /home/sdupero/proyecto-ogaac/ogaac-backend/*.BAK* /home/sdupero/ogaac-backups/
mv /home/sdupero/proyecto-ogaac/ogaac-backend/lib/*.BAK* /home/sdupero/ogaac-backups/
```
- **Tiempo:** 30 min

---

### 10. Sin Validacion de Password Strength
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/lib/users-manager.js`
- **Problema:** Solo valida username, no fuerza passwords seguros.
- **Fix:** Agregar validacion: minimo 8 chars, mayuscula, numero, simbolo
- **Tiempo:** 1 hora

---

### 11. CORS No Configurado Explicitamente
- **Ubicacion:** `package.json` tiene cors pero server.js no lo usa
- **Problema:** Sin restricciones de origen explicitas.
- **Fix:** Configurar CORS con lista de origenes permitidos
- **Tiempo:** 1 hora

---

### 12. Node.js Sin Process Manager
- **Ubicacion:** Proceso corriendo como `node server.js` directo
- **Problema:** Sin restart automatico, sin logs centralizados.
- **Fix:**
```bash
npm install -g pm2
pm2 start server.js --name ogaac-backend
pm2 save
pm2 startup
```
- **Tiempo:** 1 hora

---

### 13. HLS Fragment Size No Optimizado
- **Ubicacion:** `/etc/nginx/nginx.conf` (RTMP block)
- **Problema:** `hls_fragment 4;` genera latencia de ~12+ segundos.
- **Fix:** Reducir a `hls_fragment 2;` para menor latencia
- **Tiempo:** 30 min

---

### 14. Sin Security Headers en Nginx
- **Ubicacion:** `/etc/nginx/sites-enabled/ogaac-test.conf`
- **Fix:**
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```
- **Tiempo:** 15 min

---

### 15. Audit Log Sin Rotacion Automatica
- **Ubicacion:** `/home/sdupero/proyecto-ogaac/ogaac-backend/lib/audit.js`
- **Fix:** Configurar logrotate para logs JSONL
- **Tiempo:** 30 min

---

### 16. Scope No Validado en Todas las Rutas OBS
- **Ubicacion:** `server.js` - rutas /api/obs/:sede/:sala/*
- **Problema:** Scope se valida en /api/obs/config pero no en operaciones individuales.
- **Fix:** Agregar validacion de hasAccessToSala en cada handler de OBS
- **Tiempo:** 2 horas

---

### 17. Persistencia en JSON (No Escalable)
- **Ubicacion:** `config/users-roles.json`
- **Problema:** Sin transacciones, race conditions posibles.
- **Solucion:** Ver PLAN_ESCALABILIDAD_DB_OGAAC.md
- **Tiempo:** Sprint dedicado

---

### 18. Sin Health Check Externo
- **Problema:** /health existe pero sin alertas automaticas.
- **Fix:** Configurar cron + script de monitoreo
- **Tiempo:** 1 hora

---

## MEJORAS - Proximo Sprint

| # | Mejora | Beneficio | Tiempo |
|---|--------|-----------|--------|
| 19 | Redis para cache de sesiones | Revocacion de tokens, menor carga | 4h |
| 20 | Metricas Prometheus + Grafana | Visibilidad, alertas proactivas | 4h |
| 21 | WebSocket para updates tiempo real | Menos polling, menor latencia | 8h |
| 22 | Tests automatizados (Jest) | Prevenir regresiones | 16h |
| 23 | Audit trail con correlacion | Trazabilidad judicial | 8h |
| 24 | Separar config de codigo | Deploys sin tocar config | 4h |
| 25 | Feature flags | Activar features sin deploy | 4h |
| 26 | Documentar API (OpenAPI) | Onboarding, contratos | 8h |
| 27 | Graceful shutdown | Zero-downtime deploys | 2h |
| 28 | Gzip para assets | Menor bandwidth | 30m |

---

## METRICAS DETECTADAS

| Metrica | Valor | Estado |
|---------|-------|--------|
| Uptime servidor | 36 dias | OK |
| RAM total/usada | 11GB / 2.4GB (22%) | OK |
| Disco sistema | 17GB / 207GB (9%) | OK |
| Disco audiencias | 7TB / 9TB (78%) | MONITOREAR |
| Node.js RAM | ~85MB | OK |
| Archivos BAK | 76 | LIMPIAR |
| HLS fragment | 3-4 seg | OPTIMIZABLE |
| JWT expiration | 8 horas | MUY LARGO |
| Rate limit login | 5/min (nginx) | OK |

---

## RESUMEN

| Categoria | CRITICO | IMPORTANTE | MEJORA |
|-----------|---------|------------|--------|
| Seguridad JWT/RBAC | 5 | 4 | 2 |
| Performance HLS | 0 | 2 | 1 |
| Arquitectura | 3 | 4 | 7 |

**TOTAL: 8 Criticos | 10 Importantes | 10 Mejoras**

---

## FUENTES CONSULTADAS

- JWT Best Practices: https://www.geeksforgeeks.org/node-js/jwt-authentication-with-refresh-tokens/
- NGINX RTMP Guide 2025: https://www.videosdk.live/developer-hub/rtmp/nginx-rtmp-module
- RBAC Node.js: https://permify.co/post/role-based-access-control-rbac-nodejs-expressjs/
- HLS Streaming 2025: https://www.videosdk.live/developer-hub/hls/hls-live-streaming
