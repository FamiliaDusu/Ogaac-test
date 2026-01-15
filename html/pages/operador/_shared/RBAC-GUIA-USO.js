/**
 * ========================================
 * GUÍA DE USO - SISTEMA RBAC FRONTEND
 * ========================================
 * 
 * Sistema de control de acceso basado en roles para el panel de operador OGAAC.
 * Oculta/muestra controles según el rol del usuario (viewer/operator/admin).
 * 
 * Archivos implementados:
 * - /pages/operador/_shared/auth-rbac.js  (módulo principal)
 * - /pages/operador/_shared/panel.js       (integración)
 * - /pages/operador/suipacha/sala01/index.html (ejemplo de uso)
 */

// ========================================
// 1. EJEMPLO DE HTML CON data-permission
// ========================================

/*
<!-- Video: visible para todos -->
<article class="card card-stream">
  <video id="video" controls autoplay muted playsinline></video>
  <div id="status">...</div>
</article>

<!-- Panel de grabación: SOLO operator y admin -->
<article class="card card-audiencia" data-permission="control:recording">
  <div class="panel-head">
    <div class="panel-title">Audiencia · Grabación</div>
  </div>
  
  <div class="aud-box">
    <button onclick="startRecording()">▶ Grabar</button>
    <button onclick="stopRecording()">■ Detener</button>
  </div>
</article>

<!-- Control OBS: SOLO operator y admin -->
<article class="card card-obs" data-permission="control:obs">
  <div class="panel-head">
    <div class="panel-title">Control OBS</div>
  </div>
  
  <iframe src="/web-socket-obs/basic.html"></iframe>
</article>

<!-- Link avanzado: SOLO operator y admin -->
<a href="/advanced" data-permission="view:advanced">Avanzado</a>

<!-- Gestión de usuarios: SOLO admin -->
<section data-role="admin">
  <h2>Gestión de usuarios</h2>
  <button>Crear usuario</button>
</section>
*/

// ========================================
// 2. LISTA DE PERMISOS DISPONIBLES
// ========================================

/*
VIEWER:
  - view:stream       (ver video)
  - view:status       (ver estado OBS)
  - view:diagnostics  (ver diagnósticos)

OPERATOR (incluye todos los de viewer +):
  - control:obs       (controlar OBS: escenas, transmisión)
  - control:recording (controlar grabación)
  - control:audio     (controlar audio)
  - view:advanced     (ver controles avanzados)

ADMIN (incluye todos los anteriores +):
  - manage:users      (gestión de usuarios)
  - manage:config     (configuración del sistema)
  - view:all          (comodín: ver todo)
*/

// ========================================
// 3. API JAVASCRIPT DISPONIBLE
// ========================================

/*
// Obtener información del usuario actual
const user = OGAAC_RBAC.getCurrentUser();
// { user: "juan.perez", role: "operator", permissions: [...] }

// Verificar si tiene un permiso específico
if (OGAAC_RBAC.hasPermission('control:obs')) {
  // Mostrar botón de control OBS
}

// Verificar si tiene un rol mínimo
if (OGAAC_RBAC.hasMinRole('operator')) {
  // Código para operator o admin
}

// Obtener el rol actual
const role = OGAAC_RBAC.getRole(); // "viewer" | "operator" | "admin"

// Obtener los permisos
const permissions = OGAAC_RBAC.getPermissions(); // ["view:stream", "control:obs", ...]

// Refrescar sesión (invalidar caché y volver a aplicar)
await OGAAC_RBAC.refresh();

// Reaplicar visibilidad (útil si se modifica el DOM dinámicamente)
OGAAC_RBAC.applyRoleVisibility();
*/

// ========================================
// 4. INTEGRACIÓN EN PÁGINAS NUEVAS
// ========================================

/*
PASO 1: Cargar el script en el <head>
---------------------------------------
<script src="/operador/_shared/auth-rbac.js"></script>

PASO 2: Cargar panel.js (ya incluye inicialización)
---------------------------------------------------
<script src="/operador/_shared/panel.js"></script>

PASO 3: Agregar data-permission a elementos que requieren permisos
------------------------------------------------------------------
<button data-permission="control:obs">Iniciar transmisión</button>
<div data-role="admin">Panel de administración</div>

PASO 4: Agregar badge de usuario en el header (opcional)
---------------------------------------------------------
<div class="header-right">
  <span id="user-badge">Cargando...</span>
  <button onclick="ogaacLogout()">Cerrar sesión</button>
</div>
*/

// ========================================
// 5. PATRÓN DE IMPLEMENTACIÓN
// ========================================

/*
BUENA PRÁCTICA:
---------------
✅ Usar data-permission para controles funcionales
✅ Usar data-role para secciones completas
✅ Mantener el video y diagnósticos siempre visibles
✅ Ocultar (display:none) en lugar de deshabilitar
✅ No mostrar alertas al cargar

MALA PRÁCTICA:
--------------
❌ Hardcodear if (role === "admin") en múltiples lugares
❌ Usar disabled="disabled" (mejor ocultar completamente)
❌ Duplicar HTML para cada rol
❌ Alertas o notificaciones molestas al cargar
❌ Olvidar cargar auth-rbac.js antes de panel.js
*/

// ========================================
// 6. EJEMPLO COMPLETO DE PÁGINA
// ========================================

/*
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Operador · Sede · Sala</title>
  
  <link rel="stylesheet" href="/ogaac.css" />
  <link rel="stylesheet" href="/operador/_shared/css/control-room.css">
  
  <!-- HLS -->
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  
  <!-- RBAC (debe ir ANTES de panel.js) -->
  <script src="/operador/_shared/auth-rbac.js"></script>
</head>

<body>
  <header class="ogaac-header">
    <div class="header-left">
      <div class="ogaac-brand-title">OGAAC · Operador</div>
    </div>
    
    <div class="header-center">SEDE · SALA</div>
    
    <div class="header-right">
      <span id="user-badge">Cargando...</span>
      <button onclick="ogaacLogout()">Cerrar sesión</button>
    </div>
  </header>

  <main>
    <div class="control-grid">
      
      <!-- VIDEO: siempre visible -->
      <article class="card card-stream">
        <video id="video" controls autoplay muted playsinline></video>
        <div id="status">Cargando...</div>
      </article>
      
      <!-- GRABACIÓN: solo operator/admin -->
      <article class="card" data-permission="control:recording">
        <h3>Grabación</h3>
        <button>Iniciar grabación</button>
      </article>
      
      <!-- OBS: solo operator/admin -->
      <article class="card" data-permission="control:obs">
        <h3>Control OBS</h3>
        <iframe src="/web-socket-obs/basic.html"></iframe>
      </article>
      
    </div>
  </main>

  <script>
    const OGAAC_SEDE = "suipacha";
    const OGAAC_SALA = "sala01";
    window.OGAAC = { sede: OGAAC_SEDE, sala: OGAAC_SALA };
  </script>
  
  <script src="/operador/_shared/panel.js"></script>
</body>
</html>
*/

// ========================================
// 7. TROUBLESHOOTING
// ========================================

/*
PROBLEMA: Los controles no se ocultan
--------------------------------------
✓ Verificar que auth-rbac.js se cargó antes que panel.js
✓ Abrir consola y verificar: OGAAC_RBAC.getCurrentUser()
✓ Verificar que el backend responde en /api/auth/me
✓ Verificar data-permission="control:obs" (sin typos)

PROBLEMA: Redirige a login constantemente
------------------------------------------
✓ Verificar que /api/auth/me responde 200 con { user, role }
✓ Verificar que credentials: "include" está activo
✓ Verificar que la sesión no expiró

PROBLEMA: El badge no se actualiza
-----------------------------------
✓ Verificar que existe <span id="user-badge"></span>
✓ Verificar en consola: OGAAC_RBAC.getCurrentUser()
✓ Llamar manualmente: OGAAC_RBAC.applyRoleVisibility()

PROBLEMA: Backend devuelve 401/403
-----------------------------------
✓ Verificar que el usuario tiene rol asignado en el backend
✓ Verificar que el endpoint /api/auth/me existe
✓ Probar con curl: curl -b cookies.txt http://10.54.15.60:8080/api/auth/me
*/

console.log("Guía de uso RBAC cargada. Ver comentarios para más detalles.");
