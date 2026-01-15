// auth.js - Manejo de login OGAAC

// Usamos el proxy de Nginx
const API_URL = "/api/login";

document.addEventListener("DOMContentLoaded", () => {
  console.log("[auth.js] DOM listo, iniciando login...");

  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("error");
  const loginButton = document.getElementById("login-button");
  const userInput = document.getElementById("user");
  const passInput = document.getElementById("pass");

  console.log("[auth.js] Referencias:", { form, userInput, passInput, loginButton, errorBox });

  // Verificaciones básicas
  if (!form) {
    console.error('[auth.js] No se encontró <form id="login-form">');
    return;
  }
  if (!userInput) {
    console.error('[auth.js] No se encontró <input id="user">');
    return;
  }
  if (!passInput) {
    console.error('[auth.js] No se encontró <input id="pass">');
    return;
  }

  function showError(msg) {
    console.log("[auth.js] showError:", msg);
    if (!errorBox) {
      alert(msg);
      return;
    }
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.style.display = "none";
  }

  console.log("[auth.js] Registrando listener de submit en el form...");
  form.addEventListener("submit", async (e) => {
    console.log("[auth.js] ⚡⚡⚡ SUBMIT DISPARADO ⚡⚡⚡");
    e.preventDefault();
    console.log("[auth.js] preventDefault() ejecutado");
    clearError();

    const username = userInput.value.trim();
    const password = passInput.value;

    console.log("[auth.js] 📝 USERNAME:", username);
    console.log("[auth.js] 📝 PASSWORD LENGTH:", password.length);

    if (!username || !password) {
      console.log("[auth.js] ❌ Validación falló: campos vacíos");
      showError("Por favor, completá usuario y contraseña.");
      return;
    }

    console.log("[auth.js] ✅ Validación OK, continuando...");

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Ingresando...";
    }

    const payload = {
      // lo que espera el backend nuevo
      username,
      password,
      // compatibilidad con backend viejo (user/pass)
      user: username,
      pass: password,
    };

    console.log("[auth.js] Enviando login a", API_URL, "payload:", payload);

    try {
      console.log("[auth.js] 🚀 Ejecutando fetch...");
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        console.warn("[auth.js] No se pudo parsear JSON de la respuesta");
        data = {};
      }

      console.log("[auth.js] Respuesta /api/login:", res.status, data);

      if (!res.ok) {
        console.log("[auth.js] ❌ Response no OK, status:", res.status);
        if (data.message) {
          showError(data.message);
        } else if (data.msg) {
          showError(data.msg);
        } else {
          showError(`Error ${res.status}`);
        }
        return;
      }

      if (!data.ok || !data.token) {
        console.log("[auth.js] ❌ Sin token en respuesta, data.ok:", data.ok, "data.token:", !!data.token);
        if (data.message) {
          showError(data.message);
        } else if (data.msg) {
          showError(data.msg);
        } else {
          showError("Respuesta inválida del servidor");
        }
        return;
      }

      // Guardamos token JWT para acceso
      localStorage.setItem("ogaac_token", data.token);

      console.log("[auth.js] ✅ TOKEN GUARDADO en localStorage");
      console.log("[auth.js] 🔄 Redirigiendo a /operador/sedes.html");
      window.location.href = "/operador/sedes.html";
    } catch (err) {
      console.error("[auth.js] ❌❌❌ ERROR EN FETCH:", err);
      console.error("[auth.js] Error stack:", err.stack);
      showError("Error de conexión con el servidor");
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Ingresar";
      }
    }
  });

  console.log("[auth.js] Listener de submit registrado correctamente");
});

