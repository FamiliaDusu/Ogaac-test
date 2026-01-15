# Panel de Administración de Usuarios OGAAC

## 📍 Ubicación

- **URL:** `http://10.54.15.60:8080/operador/admin/`
- **Acceso:** Solo usuarios con rol `admin`
- **Archivos:**
  - `/var/www/ogaac-test/html/pages/operador/admin/index.html`
  - `/var/www/ogaac-test/html/pages/operador/admin/admin.js`
  - `/var/www/ogaac-test/html/pages/operador/admin/admin.css`

## 🎯 Funcionalidades

### 1. Listar Usuarios
- Tabla con todos los usuarios del sistema
- Columnas: Usuario, Rol, Origen, Estado, Acciones
- Badges de colores por rol:
  - **Admin:** Rojo (#d32f2f)
  - **Operator:** Azul (#1976d2)
  - **Viewer:** Gris (#616161)

### 2. Crear Usuario Local
- Formulario con campos:
  - Username (mínimo 3 caracteres)
  - Password (mínimo 6 caracteres)
  - Rol (viewer/operator/admin)
  - Estado (activo/inactivo)
- Validación en frontend y backend
- Password hasheado con SHA256

### 3. Editar Usuario Local
- Cambiar rol
- Activar/desactivar usuario
- Resetear contraseña (opcional)
- NO permite editar usuarios de Active Directory

### 4. Eliminar Usuario Local
- Confirmación antes de eliminar
- Solo usuarios locales
- NO permite eliminar usuarios de Active Directory

### 5. Usuarios de Active Directory
- Se muestran con badge 🔒 AD
- Solo lectura (no editables)
- Tooltip: "Gestionado por Active Directory"
- Preparado para sincronización futura

## 🔐 Seguridad

### Backend
- Endpoints protegidos con `requireRole('admin')`
- Token JWT en header `Authorization: Bearer <token>`
- Todas las operaciones requieren sesión válida
- Usuarios AD no se pueden modificar

### Frontend
- Verificación de rol en `checkAdminAccess()`
- Redirección automática si no es admin
- RBAC frontend con `data-role="admin"` en body
- Botones deshabilitados para usuarios AD

## 📡 Endpoints API

### GET `/api/admin/users`
Lista todos los usuarios con información completa.

**Response:**
```json
{
  "ok": true,
  "users": [
    {
      "username": "admin",
      "role": "admin",
      "source": "local",
      "enabled": true,
      "note": "Usuario admin",
      "createdAt": "2026-01-07T...",
      "updatedAt": "2026-01-07T..."
    }
  ],
  "roles": ["viewer", "operator", "admin"]
}
```

### POST `/api/admin/users`
Crear nuevo usuario local.

**Body:**
```json
{
  "username": "jperez",
  "password": "secure123",
  "role": "operator",
  "enabled": true
}
```

### PUT `/api/admin/users/:username`
Actualizar usuario existente.

**Body:**
```json
{
  "role": "admin",
  "enabled": false,
  "password": "newpassword123"  // opcional
}
```

### DELETE `/api/admin/users/:username`
Eliminar usuario local.

**Response:**
```json
{
  "ok": true,
  "message": "Usuario jperez eliminado"
}
```

## 🎨 Estilos

- Diseño consistente con el resto de OGAAC
- Responsive (mobile-friendly)
- Modales animados con backdrop
- Toast notifications
- Estados hover en botones y filas

### Clases CSS principales:
- `.admin-main` - Container principal
- `.admin-toolbar` - Barra de herramientas
- `.admin-table` - Tabla de usuarios
- `.role-badge` - Badge de rol con color
- `.status-badge` - Badge de estado activo/inactivo
- `.modal` - Modales para crear/editar/eliminar

## 📝 Modelo de Usuario

```json
{
  "username": "string",
  "role": "viewer|operator|admin",
  "source": "local|ad",
  "enabled": boolean,
  "passwordHash": "string (SHA256)",
  "note": "string",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

## 🔄 Flujo de Trabajo

1. **Login como admin:**
   ```
   POST /api/login
   { "username": "admin", "password": "admin" }
   ```

2. **Acceder al panel:**
   ```
   http://10.54.15.60:8080/operador/admin/
   ```

3. **Crear usuario:**
   - Clic en "➕ Crear usuario"
   - Completar formulario
   - Submit → POST /api/admin/users

4. **Editar usuario:**
   - Clic en icono ✏️
   - Modificar datos
   - Submit → PUT /api/admin/users/:username

5. **Eliminar usuario:**
   - Clic en icono 🗑️
   - Confirmar
   - DELETE /api/admin/users/:username

## 🚀 Integración con Active Directory

### Estado actual:
- LDAP/AD **PREPARADO** pero **DESHABILITADO**
- Usuarios marcados con `source: "ad"` se muestran como read-only
- UI lista para cuando se active LDAP

### Para activar LDAP:
1. En `/var/www/ogaac/backend/lib/auth-ldap.js`:
   ```javascript
   LDAP_CONFIG.enabled = true
   ```

2. Configurar credenciales de service account:
   ```javascript
   bindDN: "CN=svc_ogaac,OU=ServiceAccounts,DC=cmcaba,DC=gob,DC=ar"
   bindPassword: "PASSWORD_REAL"
   ```

3. Los usuarios AD se sincronizarán automáticamente
4. No se puede editar ni eliminar usuarios AD desde el panel

## 🧪 Testing

### Usuarios de prueba (password: admin):
- `admin` → admin
- `operator` → operator
- `viewer` → viewer
- `sdupero` → admin

### Casos de prueba:
```bash
# 1. Login como admin
curl -X POST http://127.0.0.1:8081/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# 2. Listar usuarios
curl -H "Authorization: Bearer TOKEN" \
  http://127.0.0.1:8081/api/admin/users

# 3. Crear usuario
curl -X POST -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123","role":"operator"}' \
  http://127.0.0.1:8081/api/admin/users

# 4. Intentar acceder como viewer (debe fallar)
curl -X POST http://127.0.0.1:8081/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer","password":"admin"}'

curl -H "Authorization: Bearer VIEWER_TOKEN" \
  http://127.0.0.1:8081/api/admin/users
# Response: {"ok":false,"code":"FORBIDDEN",...}
```

## 📋 Checklist de Implementación

- ✅ Backend: endpoints CRUD con RBAC
- ✅ Frontend: UI completa con modales
- ✅ Estilos: diseño consistente
- ✅ Seguridad: verificación de roles
- ✅ Validaciones: frontend + backend
- ✅ Usuarios AD: preparado para integración
- ✅ Navegación: enlace en sedes.html
- ✅ Testing: todas las funciones probadas

## 🐛 Troubleshooting

### El botón "Admin" no aparece
- Verificar que estás logueado como admin
- Abrir consola: `window.OGAAC_RBAC.hasMinRole('admin')`
- Debe retornar `true`

### Error 403 al acceder al panel
- El backend verifica que seas admin
- Revisar logs: `tail -f /tmp/ogaac-backend.log`

### Los usuarios no se cargan
- Verificar que el backend está corriendo: `curl http://127.0.0.1:8081/api/ping`
- Verificar token válido: `localStorage.getItem('token')`
- Revisar consola del navegador

### No puedo crear usuarios
- Verificar formato de password (mínimo 6 caracteres)
- Username debe ser único
- Rol debe ser viewer, operator o admin

## 📚 Referencias

- Backend: `/var/www/ogaac/backend/server.js` (líneas 169-272)
- Roles: `/var/www/ogaac/backend/lib/roles.js`
- Autenticación: `/var/www/ogaac/backend/lib/auth-ldap.js`
- Config usuarios: `/var/www/ogaac/backend/config/users-roles.json`
- RBAC Frontend: `/var/www/ogaac-test/html/pages/operador/_shared/auth-rbac.js`

---

**Última actualización:** 2026-01-07  
**Versión:** 1.0.0  
**Estado:** ✅ Producción (entorno test)
