# ========================================
# CHECKLIST DE TESTS - SISTEMA RBAC FRONTEND
# ========================================

## 🔧 PREPARACIÓN DEL TEST

### Backend necesario:
- [ ] Backend corriendo en puerto 8081
- [ ] Endpoint /api/auth/me implementado
- [ ] Usuarios de prueba creados:
  - viewer_test (rol: viewer)
  - operator_test (rol: operator)
  - admin_test (rol: admin)

### Frontend:
- [ ] Nginx sirviendo en puerto 8080
- [ ] ogaac-test/html actualizado con cambios RBAC
- [ ] Navegador en modo incógnito (para evitar caché)

---

## 🧪 TEST 1: ROL VIEWER (Solo lectura)

### Usuario: viewer_test

### Navegación:
1. [ ] Login exitoso con viewer_test
2. [ ] Acceder a: http://10.54.15.60:8080/operador/suipacha/sala01/

### Comportamiento esperado:

#### ✅ VISIBLE (viewer PUEDE ver):
- [ ] Video HLS streaming
- [ ] Estado de conexión (tag "En vivo" / "Sin señal")
- [ ] Badge de usuario con "Visor" (azul)
- [ ] Botón "Cerrar sesión"
- [ ] Botones de navegación ("Volver al Portal", "Volver a la sede")

#### ❌ OCULTO (viewer NO puede ver):
- [ ] Panel "Audiencia · Grabación" (completo)
- [ ] Panel "Control OBS" con iframe (completo)
- [ ] Link "Avanzado" en header de OBS
- [ ] Cualquier botón de control (grabar, transmitir, etc.)

### Test de consola:
```javascript
// En la consola del navegador:
OGAAC_RBAC.getCurrentUser()
// Debe retornar: { user: "viewer_test", role: "viewer", permissions: [...] }

OGAAC_RBAC.hasPermission('control:obs')
// Debe retornar: false

OGAAC_RBAC.hasPermission('view:stream')
// Debe retornar: true
```

### Test manual:
- [ ] Inspeccionar DOM: elementos con `data-permission="control:obs"` tienen `display: none`
- [ ] Inspeccionar DOM: elementos con `data-permission="control:recording"` tienen `display: none`

---

## 🧪 TEST 2: ROL OPERATOR (Control de salas)

### Usuario: operator_test

### Navegación:
1. [ ] Login exitoso con operator_test
2. [ ] Acceder a: http://10.54.15.60:8080/operador/suipacha/sala01/

### Comportamiento esperado:

#### ✅ VISIBLE (operator PUEDE ver TODO):
- [ ] Video HLS streaming
- [ ] Estado de conexión
- [ ] Badge de usuario con "Operador" (naranja)
- [ ] Panel "Audiencia · Grabación"
  - [ ] Campos: fecha, fuero, juzgado, expediente, sala
  - [ ] Botones: "Iniciar", "Detener", "Cargar", "Limpiar"
- [ ] Panel "Control OBS"
  - [ ] Iframe con controles OBS básicos
  - [ ] Estado OBS (pill con "OBS: Conectado" o similar)
  - [ ] Link "Básico"
  - [ ] Link "Abrir"
- [ ] Link "Avanzado" (data-permission="view:advanced")

#### ❌ OCULTO (operator NO puede ver):
- [ ] Paneles de administración (si existen con data-role="admin")
- [ ] Gestión de usuarios (si existe)

### Test de consola:
```javascript
OGAAC_RBAC.getCurrentUser()
// Debe retornar: { user: "operator_test", role: "operator", permissions: [...] }

OGAAC_RBAC.hasPermission('control:obs')
// Debe retornar: true

OGAAC_RBAC.hasPermission('control:recording')
// Debe retornar: true

OGAAC_RBAC.hasMinRole('operator')
// Debe retornar: true
```

### Test funcional:
- [ ] Probar cambiar escena en el iframe OBS (debe funcionar)
- [ ] Probar iniciar/detener grabación (debe funcionar si backend lo permite)

---

## 🧪 TEST 3: ROL ADMIN (Acceso completo)

### Usuario: admin_test

### Navegación:
1. [ ] Login exitoso con admin_test
2. [ ] Acceder a: http://10.54.15.60:8080/operador/suipacha/sala01/

### Comportamiento esperado:

#### ✅ VISIBLE (admin ve TODO):
- [ ] Todo lo que ve operator
- [ ] Badge de usuario con "Administrador" (verde)
- [ ] Paneles adicionales de administración (si existen)
- [ ] Cualquier elemento con data-role="admin"

### Test de consola:
```javascript
OGAAC_RBAC.getCurrentUser()
// Debe retornar: { user: "admin_test", role: "admin", permissions: [...] }

OGAAC_RBAC.hasPermission('manage:users')
// Debe retornar: true

OGAAC_RBAC.hasPermission('view:all')
// Debe retornar: true (comodín)

OGAAC_RBAC.getPermissions()
// Debe incluir todos los permisos
```

---

## 🧪 TEST 4: MANEJO DE ERRORES

### Test 4.1: Sesión no válida
1. [ ] Limpiar cookies del navegador
2. [ ] Acceder a: http://10.54.15.60:8080/operador/suipacha/sala01/
3. [ ] Debe redirigir automáticamente a /login.html

### Test 4.2: Backend no responde
1. [ ] Detener el backend (node)
2. [ ] Recargar la página
3. [ ] Debe redirigir a /login.html (timeout o error de red)

### Test 4.3: Cambio de rol en caliente
1. [ ] Login como operator
2. [ ] Verificar que ve los controles OBS
3. [ ] En otra pestaña, cambiar el rol a viewer (base de datos)
4. [ ] En consola: `await OGAAC_RBAC.refresh()`
5. [ ] Los controles OBS deben ocultarse inmediatamente

---

## 🧪 TEST 5: MULTI-SALA (Verificar consistencia)

### Test en múltiples salas:
- [ ] /operador/suipacha/sala01/ → funciona con RBAC
- [ ] /operador/suipacha/sala02/ → funciona con RBAC
- [ ] /operador/suipacha/sala10/ → funciona con RBAC

### Para cada sala:
1. [ ] Login como viewer → controles ocultos
2. [ ] Login como operator → controles visibles
3. [ ] Badge se actualiza correctamente

---

## 🧪 TEST 6: NAVEGADOR Y CACHÉ

### Test 6.1: Hard refresh
1. [ ] Cargar página como operator
2. [ ] Hacer Ctrl + Shift + R (hard refresh)
3. [ ] Debe seguir mostrando controles (no pierde sesión)

### Test 6.2: Nueva pestaña
1. [ ] Login como operator
2. [ ] Abrir nueva pestaña
3. [ ] Ir a: http://10.54.15.60:8080/operador/suipacha/sala01/
4. [ ] Debe mantener la sesión (cookies compartidas)

### Test 6.3: Incógnito
1. [ ] Abrir ventana incógnito
2. [ ] Login como viewer
3. [ ] Acceder a sala
4. [ ] Verificar que solo ve video (sin controles)
5. [ ] En pestaña normal, seguir como operator (sesiones independientes)

---

## 🧪 TEST 7: INTEGRACIÓN BACKEND

### Verificar endpoint /api/auth/me:
```bash
# Como viewer
curl -b cookies_viewer.txt http://10.54.15.60:8080/api/auth/me
# Debe retornar: {"user":"viewer_test","role":"viewer","permissions":[...]}

# Como operator
curl -b cookies_operator.txt http://10.54.15.60:8080/api/auth/me
# Debe retornar: {"user":"operator_test","role":"operator","permissions":[...]}

# Sin cookies
curl http://10.54.15.60:8080/api/auth/me
# Debe retornar: 401 Unauthorized
```

### Verificar que otros endpoints respetan RBAC:
```bash
# Viewer intenta controlar OBS (debe fallar 403)
curl -X POST -b cookies_viewer.txt http://10.54.15.60:8080/api/obs/scene/switch

# Operator intenta controlar OBS (debe funcionar 200)
curl -X POST -b cookies_operator.txt http://10.54.15.60:8080/api/obs/scene/switch
```

---

## ✅ CRITERIOS DE ACEPTACIÓN

### Para dar por finalizado el sistema RBAC:
- [ ] Todos los tests de viewer pasan (controles ocultos)
- [ ] Todos los tests de operator pasan (controles visibles)
- [ ] Todos los tests de admin pasan (todo visible)
- [ ] Redirige a login cuando no hay sesión
- [ ] Badge se actualiza correctamente
- [ ] No hay errores en consola del navegador
- [ ] Panel.js carga correctamente auth-rbac.js
- [ ] Múltiples salas funcionan consistentemente
- [ ] El código no duplica HTML
- [ ] La UX es limpia (sin alertas molestas)

---

## 🐛 REGISTRO DE BUGS

Si encuentras errores, anotarlos aquí:

### Bug #1: [Descripción]
- **Reproducir:** [pasos]
- **Esperado:** [comportamiento esperado]
- **Actual:** [comportamiento actual]
- **Rol:** [viewer/operator/admin]
- **Navegador:** [Chrome/Firefox/Safari]
- **Consola:** [errores en consola]

---

## 📊 RESUMEN DE RESULTADOS

| Test | Viewer | Operator | Admin | Estado |
|------|--------|----------|-------|--------|
| T1: Controles ocultos | ⬜ | - | - | Pendiente |
| T2: Controles visibles | - | ⬜ | - | Pendiente |
| T3: Acceso completo | - | - | ⬜ | Pendiente |
| T4: Manejo errores | ⬜ | ⬜ | ⬜ | Pendiente |
| T5: Multi-sala | ⬜ | ⬜ | ⬜ | Pendiente |
| T6: Navegador/caché | ⬜ | ⬜ | ⬜ | Pendiente |
| T7: Backend | ⬜ | ⬜ | ⬜ | Pendiente |

**Leyenda:**
- ⬜ Pendiente
- ✅ Pasó
- ❌ Falló
- ⚠️ Parcial

---

## 🚀 INSTRUCCIONES RÁPIDAS

### Test rápido manual (5 minutos):

```bash
# 1. Login como viewer en navegador
# 2. Ir a: http://10.54.15.60:8080/operador/suipacha/sala01/
# 3. Verificar que NO se ven controles OBS ni grabación

# 4. Login como operator
# 5. Ir a: http://10.54.15.60:8080/operador/suipacha/sala01/
# 6. Verificar que SÍ se ven controles OBS y grabación

# 7. En consola:
OGAAC_RBAC.getCurrentUser()
OGAAC_RBAC.hasPermission('control:obs')
```

---

**Fecha de creación:** 7 de enero de 2026
**Versión:** 1.0
**Proyecto:** OGAAC ogaac-test
