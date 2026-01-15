/**
 * auth-rbac.js - Sistema RBAC Frontend para Panel OGAAC
 * 
 * Gestiona roles (viewer/operator/admin) y permisos granulares.
 * Oculta/muestra controles según el rol del usuario autenticado.
 * 
 * Uso:
 *   await OGAAC_RBAC.init();
 *   OGAAC_RBAC.applyRoleVisibility();
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURACIÓN
  // ============================================
  const API_AUTH_ME = '/api/me';
  const CACHE_DURATION_MS = 30000; // 30 segundos
  
  // ============================================
  // ESTADO GLOBAL
  // ============================================
  let currentUser = null;
  let cacheTimestamp = 0;
  let initPromise = null;

  // ============================================
  // MAPEO DE PERMISOS POR ROL
  // ============================================
  const ROLE_PERMISSIONS = {
    viewer: [
      'view:stream',       // Ver video
      'view:status',       // Ver estado OBS
      'view:diagnostics'   // Ver diagnósticos
    ],
    operator: [
      'view:stream',
      'view:status',
      'view:diagnostics',
      'control:obs',       // Controlar OBS (escenas, transmisión)
      'control:recording', // Controlar grabación
      'control:audio',     // Controlar audio
      'view:advanced'      // Ver controles avanzados
    ],
    admin: [
      'view:stream',
      'view:status',
      'view:diagnostics',
      'control:obs',
      'control:recording',
      'control:audio',
      'view:advanced',
      'manage:users',      // Gestión de usuarios
      'manage:config',     // Configuración del sistema
      'view:all'           // Ver todo (comodín)
    ]
  };

  // ============================================
  // FUNCIÓN: Obtener sesión desde backend
  // ============================================
  async function fetchCurrentUser() {
    const now = Date.now();
    
    // Usar caché si es válido
    if (currentUser && (now - cacheTimestamp) < CACHE_DURATION_MS) {
      return currentUser;
    }

    // Obtener token de localStorage
    const token = localStorage.getItem('ogaac_token');
    
    if (!token) {
      console.warn('[RBAC] No hay token en localStorage');
      window.location.href = '/login.html';
      return null;
    }

    try {
      const res = await fetch(API_AUTH_ME, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        console.warn('[RBAC] /api/me falló:', res.status);
        
        // Si es 401, limpiar token y redirigir
        if (res.status === 401) {
          console.error('[RBAC] Token inválido o expirado, redirigiendo a login');
          localStorage.removeItem('ogaac_token');
          window.location.href = '/login.html';
          return null;
        }
        
        return null;
      }

      const data = await res.json();
      
      if (!data.user || !data.role) {
        console.warn('[RBAC] Respuesta inválida de /api/me:', data);
        return null;
      }

      // Obtener permisos del backend o usar los del rol por defecto
      const permissions = data.permissions || ROLE_PERMISSIONS[data.role] || [];

      // SCOPE: Obtener scope del backend (null = acceso total)
      const scope = data.scope || null;

      currentUser = {
        user: data.user,
        role: data.role,
        permissions: permissions,
        scope: scope  // { sedes: [...], salas: { sede: [...] } } | null
      };

      cacheTimestamp = now;

      console.log('[RBAC] Usuario autenticado:', currentUser.user, '| Rol:', currentUser.role, '| Scope:', scope ? 'Restringido' : 'Total');

      return currentUser;

    } catch (err) {
      console.error('[RBAC] Error obteniendo sesión:', err);
      return null;
    }
  }

  // ============================================
  // FUNCIÓN: Verificar si tiene un permiso
  // ============================================
  function hasPermission(permission) {
    if (!currentUser || !currentUser.permissions) {
      return false;
    }

    // Admin tiene permiso 'view:all' (comodín)
    if (currentUser.permissions.includes('view:all')) {
      return true;
    }

    return currentUser.permissions.includes(permission);
  }

  // ============================================
  // FUNCIÓN: Verificar si tiene un rol mínimo
  // ============================================
  function hasMinRole(minRole) {
    if (!currentUser) return false;

    const roleHierarchy = {
      'viewer': 0,
      'operator': 1,
      'admin': 2
    };

    const currentLevel = roleHierarchy[currentUser.role] || 0;
    const requiredLevel = roleHierarchy[minRole] || 0;

    return currentLevel >= requiredLevel;
  }

  // ============================================
  // FUNCIÓN: Aplicar visibilidad por rol
  // ============================================
  function applyRoleVisibility() {
    if (!currentUser) {
      console.warn('[RBAC] No hay usuario cargado, no se aplica visibilidad');
      return;
    }

    // 1. Procesar elementos con data-permission
    const permissionElements = document.querySelectorAll('[data-permission]');
    
    permissionElements.forEach(el => {
      const requiredPermission = el.getAttribute('data-permission');
      
      if (hasPermission(requiredPermission)) {
        // Tiene permiso: mostrar
        el.style.display = '';
        el.removeAttribute('hidden');
        el.classList.remove('rbac-hidden');
      } else {
        // No tiene permiso: ocultar
        el.style.display = 'none';
        el.setAttribute('hidden', 'hidden');
        el.classList.add('rbac-hidden');
      }
    });

    // 2. Procesar elementos con data-role (rol mínimo requerido)
    const roleElements = document.querySelectorAll('[data-role]');
    
    roleElements.forEach(el => {
      const requiredRole = el.getAttribute('data-role');
      
      if (hasMinRole(requiredRole)) {
        // Tiene el rol: mostrar
        el.style.display = '';
        el.removeAttribute('hidden');
        el.classList.remove('rbac-hidden');
      } else {
        // No tiene el rol: ocultar
        el.style.display = 'none';
        el.setAttribute('hidden', 'hidden');
        el.classList.add('rbac-hidden');
      }
    });

    // 3. Actualizar badge del header si existe
    updateUserBadge();

    console.log('[RBAC] Visibilidad aplicada para rol:', currentUser.role);
  }

  // ============================================
  // FUNCIÓN: Actualizar badge de usuario
  // ============================================
  function updateUserBadge() {
    const badge = document.getElementById('user-badge');
    if (!badge || !currentUser) return;

    const roleLabels = {
      'viewer': 'Visor',
      'operator': 'Operador',
      'admin': 'Administrador'
    };

    const roleColors = {
      'viewer': '#2196F3',
      'operator': '#FF9800',
      'admin': '#4CAF50'
    };

    const roleLabel = roleLabels[currentUser.role] || currentUser.role;
    const roleColor = roleColors[currentUser.role] || '#666';

    badge.innerHTML = `
      <span style="opacity: 0.9;">${currentUser.user}</span>
      <span style="
        display: inline-block;
        padding: 2px 8px;
        margin-left: 8px;
        background: ${roleColor};
        color: #fff;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
      ">${roleLabel}</span>
    `;
  }

  // ============================================
  // FUNCIÓN: Inicializar RBAC
  // ============================================
  async function init() {
    // Evitar múltiples inicializaciones simultáneas
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      console.log('[RBAC] Inicializando sistema RBAC...');
      
      const user = await fetchCurrentUser();
      
      if (!user) {
        console.warn('[RBAC] No se pudo obtener usuario, redirigiendo...');
        // Ya se redirige en fetchCurrentUser si es 401
        return false;
      }

      // Aplicar visibilidad inicial
      applyRoleVisibility();

      return true;
    })();

    return initPromise;
  }

  // ============================================
  // FUNCIÓN: Refrescar y reaplicar
  // ============================================
  async function refresh() {
    cacheTimestamp = 0; // Invalidar caché
    await fetchCurrentUser();
    applyRoleVisibility();
  }

  // ============================================
  // SCOPE: Verificar acceso a sede/sala
  // ============================================
  /**
   * Verifica si el usuario tiene acceso a una sede/sala específica
   * @param {string} sede - Nombre de la sede
   * @param {string} sala - Nombre de la sala (opcional)
   * @returns {boolean} - true si tiene acceso
   */
  function hasAccessToSala(sede, sala) {
    if (!currentUser) return false;

    const scope = currentUser.scope;

    // null/undefined scope = acceso total
    if (!scope) return true;

    const sedeKey = (sede || '').toLowerCase();
    const salaKey = (sala || '').toLowerCase();
    const allowedSedes = scope.sedes || [];
    const allowedSalasBySede = scope.salas || {};

    // Si el scope tiene lista de sedes y la sede NO está permitida, denegar
    if (allowedSedes.length > 0 && !allowedSedes.includes(sedeKey)) {
      return false;
    }

    // Si solo se pregunta por sede (no sala específica)
    if (!sala) {
      return allowedSedes.includes(sedeKey);
    }

    // Si el scope tiene lista específica de salas para esta sede, verificar
    if (allowedSalasBySede[sedeKey]) {
      return allowedSalasBySede[sedeKey].includes(salaKey);
    }

    // Si la sede está en allowedSedes pero no hay restricción de salas, permitir
    if (allowedSedes.includes(sedeKey)) {
      return true;
    }

    // Por defecto, denegar
    return false;
  }

  /**
   * Filtra una lista de salas según el scope del usuario
   * @param {Array} salas - Array de objetos sala con {sede, sala, ...}
   * @returns {Array} - Salas filtradas
   */
  function filterSalasByScope(salas) {
    if (!currentUser || !currentUser.scope) {
      // Sin scope = acceso total
      return salas;
    }

    return salas.filter(sala => hasAccessToSala(sala.sede, sala.sala));
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  window.OGAAC_RBAC = {
    init,
    refresh,
    applyRoleVisibility,
    hasPermission,
    hasMinRole,
    getCurrentUser: () => currentUser,
    getRole: () => currentUser ? currentUser.role : null,
    getPermissions: () => currentUser ? currentUser.permissions : [],
    getScope: () => currentUser ? currentUser.scope : null,
    hasAccessToSala,
    filterSalasByScope
  };

  console.log('[RBAC] Módulo auth-rbac.js cargado');

})();
