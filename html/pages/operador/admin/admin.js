/**
 * admin.js - Panel de Administración de Usuarios OGAAC
 * 
 * Funcionalidades:
 * - Listar usuarios (locales y AD)
 * - Crear usuarios locales con contraseña
 * - Editar usuarios locales (rol, estado, password)
 * - Eliminar usuarios locales
 * - Usuarios AD: solo lectura
 */

// ============================================
// CONFIGURACIÓN
// ============================================

const API_BASE = '/api';
const ROLE_COLORS = {
  admin: '#d32f2f',
  operator: '#1976d2',
  viewer: '#616161'
};

const ROLE_LABELS = {
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer'
};

let currentUsers = [];
let userToDelete = null;

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Admin Panel] Inicializando...');
  
  // Verificar autenticación y rol
  await checkAdminAccess();
  
  // Inicializar RBAC
  if (window.OGAAC_RBAC) {
    await window.OGAAC_RBAC.init();
  }
  
  // Cargar usuarios
  await loadUsers();
  
  // Event listeners
  setupEventListeners();
  
  console.log('[Admin Panel] Listo');
});

// ============================================
// VERIFICACIÓN DE ACCESO
// ============================================

async function checkAdminAccess() {
  try {
    const token = localStorage.getItem('ogaac_token');
    
    if (!token) {
      showToast('Sesión no encontrada. Redirigiendo al login...', 'error');
      setTimeout(() => window.location.href = '/html/index.html', 2000);
      return;
    }

    const response = await fetch(`${API_BASE}/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Autenticación fallida');
    }

    const data = await response.json();
    
    if (data.role !== 'admin') {
      showToast('Acceso denegado. Solo administradores pueden acceder a esta página.', 'error');
      setTimeout(() => window.location.href = '/operador/sedes.html', 2000);
      return;
    }

    console.log('[Admin] Acceso verificado:', data.user);
    
  } catch (err) {
    console.error('[Admin] Error verificando acceso:', err);
    showToast('Error de autenticación', 'error');
    setTimeout(() => window.location.href = '/html/index.html', 2000);
  }
}

// ============================================
// CARGAR USUARIOS
// ============================================

async function loadUsers() {
  try {
    const token = localStorage.getItem('ogaac_token');
    
    const response = await fetch(`${API_BASE}/admin/users`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Error al cargar usuarios');
    }

    const data = await response.json();
    currentUsers = data.users || [];
    
    renderUsersTable(currentUsers);
    updateUserCount(currentUsers.length);
    
  } catch (err) {
    console.error('[Admin] Error cargando usuarios:', err);
    showToast('Error al cargar usuarios', 'error');
    
    document.getElementById('usersTableBody').innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:40px;color:#d32f2f;">
          Error al cargar usuarios. Intenta recargar la página.
        </td>
      </tr>
    `;
  }
}

// ============================================
// RENDERIZAR TABLA
// ============================================

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  
  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:40px;color:#666;">
          No hay usuarios registrados
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const isAD = user.source === 'ad';
    const isEnabled = user.enabled !== false;
    const roleColor = ROLE_COLORS[user.role] || '#666';
    const roleName = ROLE_LABELS[user.role] || user.role;

    return `
      <tr class="${!isEnabled ? 'user-disabled' : ''}">
        <td>
          <strong>${escapeHtml(user.username)}</strong>
          ${isAD ? '<span class="badge badge-ad" title="Gestionado por Active Directory">🔒 AD</span>' : ''}
        </td>
        <td>
          <span class="role-badge" style="background-color:${roleColor};">
            ${roleName}
          </span>
        </td>
        <td>
          <span class="source-badge source-${user.source}">
            ${user.source === 'local' ? 'Local' : 'Active Directory'}
          </span>
        </td>
        <td>
          <span class="status-badge status-${isEnabled ? 'active' : 'inactive'}">
            ${isEnabled ? '✓ Activo' : '✗ Inactivo'}
          </span>
        </td>
        <td class="actions-cell">
          ${isAD ? `
            <button class="btn-icon" disabled title="Usuarios AD no se pueden editar">
              <span style="opacity:0.3;">✏️</span>
            </button>
            <button class="btn-icon" disabled title="Usuarios AD no se pueden eliminar">
              <span style="opacity:0.3;">🗑️</span>
            </button>
          ` : `
            <button class="btn-icon btn-edit" onclick="openEditModal('${escapeHtml(user.username)}')" title="Editar usuario">
              ✏️
            </button>
            <button class="btn-icon btn-delete" onclick="openDeleteModal('${escapeHtml(user.username)}')" title="Eliminar usuario">
              🗑️
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function updateUserCount(count) {
  const el = document.getElementById('userCount');
  el.textContent = `${count} usuario${count !== 1 ? 's' : ''}`;
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Botón crear usuario
  document.getElementById('btnCreateUser').addEventListener('click', openCreateModal);
  
  // Form crear usuario
  document.getElementById('formCreateUser').addEventListener('submit', handleCreateUser);
  
  // Form editar usuario
  document.getElementById('formEditUser').addEventListener('submit', handleEditUser);
  
  // Cerrar modales al hacer clic fuera
  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  });
}

// ============================================
// MODALES
// ============================================

function openCreateModal() {
  document.getElementById('modalCreateUser').style.display = 'flex';
  document.getElementById('formCreateUser').reset();
  document.getElementById('createUsername').focus();
}

function openEditModal(username) {
  const user = currentUsers.find(u => u.username === username);
  
  if (!user) {
    showToast('Usuario no encontrado', 'error');
    return;
  }

  if (user.source === 'ad') {
    showToast('Los usuarios de Active Directory no se pueden editar', 'warning');
    return;
  }

  document.getElementById('editUsername').value = user.username;
  document.getElementById('editUsernameDisplay').value = user.username;
  document.getElementById('editRole').value = user.role;
  document.getElementById('editEnabled').checked = user.enabled !== false;
  document.getElementById('editPassword').value = '';
  
  document.getElementById('modalEditUser').style.display = 'flex';
}

function openDeleteModal(username) {
  const user = currentUsers.find(u => u.username === username);
  
  if (!user) {
    showToast('Usuario no encontrado', 'error');
    return;
  }

  if (user.source === 'ad') {
    showToast('Los usuarios de Active Directory no se pueden eliminar', 'warning');
    return;
  }

  userToDelete = username;
  document.getElementById('deleteUsername').textContent = username;
  document.getElementById('modalDeleteUser').style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// ============================================
// CREAR USUARIO
// ============================================

async function handleCreateUser(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const userData = {
    username: formData.get('username').trim(),
    password: formData.get('password'),
    role: formData.get('role'),
    enabled: formData.get('enabled') === 'on'
  };

  // Validaciones
  if (userData.username.length < 3) {
    showToast('El nombre de usuario debe tener al menos 3 caracteres', 'error');
    return;
  }

  if (userData.password.length < 6) {
    showToast('La contraseña debe tener al menos 6 caracteres', 'error');
    return;
  }

  try {
    const token = localStorage.getItem('ogaac_token');
    
    const response = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(userData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Error al crear usuario');
    }

    showToast('Usuario creado correctamente', 'success');
    closeModal('modalCreateUser');
    await loadUsers();
    
  } catch (err) {
    console.error('[Admin] Error creando usuario:', err);
    showToast(err.message || 'Error al crear usuario', 'error');
  }
}

// ============================================
// EDITAR USUARIO
// ============================================

async function handleEditUser(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const username = formData.get('username');
  const updates = {
    role: formData.get('role'),
    enabled: formData.get('enabled') === 'on'
  };

  const password = formData.get('password');
  if (password) {
    if (password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'error');
      return;
    }
    updates.password = password;
  }

  try {
    const token = localStorage.getItem('ogaac_token');
    
    const response = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Error al actualizar usuario');
    }

    showToast('Usuario actualizado correctamente', 'success');
    closeModal('modalEditUser');
    await loadUsers();
    
  } catch (err) {
    console.error('[Admin] Error actualizando usuario:', err);
    showToast(err.message || 'Error al actualizar usuario', 'error');
  }
}

// ============================================
// ELIMINAR USUARIO
// ============================================

async function confirmDelete() {
  if (!userToDelete) return;

  try {
    const token = localStorage.getItem('ogaac_token');
    
    const response = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userToDelete)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Error al eliminar usuario');
    }

    showToast('Usuario eliminado correctamente', 'success');
    closeModal('modalDeleteUser');
    userToDelete = null;
    await loadUsers();
    
  } catch (err) {
    console.error('[Admin] Error eliminando usuario:', err);
    showToast(err.message || 'Error al eliminar usuario', 'error');
  }
}

// ============================================
// UTILIDADES
// ============================================

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} toast-show`;
  
  setTimeout(() => {
    toast.classList.remove('toast-show');
  }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Exponer funciones globales
window.openEditModal = openEditModal;
window.openDeleteModal = openDeleteModal;
window.closeModal = closeModal;
window.confirmDelete = confirmDelete;
