// guard.js - Protección básica del portal OGAAC

(function () {
  const path = window.location.pathname || "";

  // Páginas donde NO queremos aplicar la protección
  if (path.endsWith("/login.html") || path.endsWith("/logout.html")) {
    console.log("[guard.js] Página de login/logout, no se aplica protección.");
    return;
  }

  const token = localStorage.getItem("ogaac_token");

  // Si no hay token → directo al login
  if (!token) {
    console.warn("[guard.js] Sin token, redirigiendo a login.html");
    window.location.href = "login.html";
    return;
  }

  // Validamos el token con el backend (opcional pero recomendado)
  fetch("/api/check", {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + token,
    },
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }

      console.log("[guard.js] Resultado /api/check:", res.status, data);

      if (
        res.status === 401 ||
        (data &&
          data.ok === false &&
          data.message &&
          data.message.toLowerCase().includes("token"))
      ) {
        console.warn("[guard.js] Token inválido o vencido, limpiando y enviando a login");
        localStorage.removeItem("ogaac_token");
        window.location.href = "login.html";
        return;
      }

      if (!res.ok) {
        console.warn("[guard.js] /api/check respondió algo raro, pero se permite el acceso.");
      }
    })
    .catch((err) => {
      console.error("[guard.js] Error llamando a /api/check:", err);
      // Si el backend no responde, dejamos pasar igual para no generar loop
    });
})();
