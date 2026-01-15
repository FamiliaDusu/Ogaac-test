/**
 * logout.js - Función global de logout para OGAAC
 *
 * Define window.ogaacLogout() disponible en TODAS las páginas.
 * También maneja botones con data-action="logout".
 */

(function() {
  'use strict';

  /**
   * Función global de logout
   * - Borra token JWT de localStorage
   * - Limpia cache RBAC si existe
   * - Redirige a /login.html
   */
  window.ogaacLogout = function ogaacLogout() {
    console.log('[logout] Cerrando sesión...');

    // 1) Borrar token
    localStorage.removeItem('ogaac_token');
    console.log('[logout] Token eliminado de localStorage');

    // 2) Limpiar cache RBAC si existe (window.currentUser, etc.)
    try {
      if (window.currentUser) {
        delete window.currentUser;
      }
      // Si auth-rbac.js tiene estado interno, limpiarlo
      if (window.OGAAC_RBAC && typeof window.OGAAC_RBAC.clearCache === 'function') {
        window.OGAAC_RBAC.clearCache();
      }
    } catch (e) {
      console.warn('[logout] Error limpiando cache RBAC:', e);
    }

    // 3) Redirigir a login
    console.log('[logout] Redirigiendo a /login.html');
    location.href = '/login.html';
  };

  /**
   * Handler para botones con data-action="logout"
   * Uso: <button data-action="logout">Cerrar sesión</button>
   */
  document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-action="logout"]');
    if (target) {
      e.preventDefault();
      window.ogaacLogout();
    }
  });

  console.log('[logout] Módulo cargado. window.ogaacLogout() disponible.');

})();
