(() => {
  function canonicalSalaId(raw) {
    if (window.OGAAC_HLS && typeof window.OGAAC_HLS.canonicalSalaId === "function") {
      return window.OGAAC_HLS.canonicalSalaId(raw);
    }
    if (raw === undefined || raw === null) return "";
    const text = String(raw).trim().toLowerCase();
    const match = text.match(/^(?:sala)?0*(\d+)$/);
    if (match) return `sala${parseInt(match[1], 10)}`;
    return text || "";
  }

  const cfg = window.OGAAC || {};
  const SEDE = (cfg.sede || "").toLowerCase();
  const SALA = canonicalSalaId(cfg.sala);
  let hlsController = null;
  let diagControls = null;
  let diagStyleInjected = false;
  let hlsHelperPromise = null;

  if (!SEDE || !SALA) {
    console.error("Falta window.OGAAC {sede,sala}. ¿Cargaste config.js?");
    return;
  }

  // ------------------ AUTH + RBAC ------------------
  async function checkAuthOrRedirect() {
    try {
      const r = await fetch("/api/check", { credentials: "include" });
      if (!r.ok) location.href = "/login.html";
    } catch {
      location.href = "/login.html";
    }
  }

  // Inicializar RBAC si está disponible
  async function initRBAC() {
    if (window.OGAAC_RBAC) {
      try {
        await window.OGAAC_RBAC.init();
        console.log('[panel.js] RBAC inicializado');
      } catch (err) {
        console.warn('[panel.js] Error inicializando RBAC:', err);
      }
    } else {
      console.warn('[panel.js] OGAAC_RBAC no disponible (auth-rbac.js no cargado)');
    }
  }

    function ensureHlsHelper() {
      if (window.OGAAC_HLS) return Promise.resolve();
      if (hlsHelperPromise) return hlsHelperPromise;

      hlsHelperPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/_shared/hls-player.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No pude cargar /_shared/hls-player.js"));
        document.head.appendChild(script);
      });

      return hlsHelperPromise;
    }

  window.ogaacLogout = function ogaacLogout() {
    localStorage.removeItem('ogaac_token');
    location.href = "/login.html";
  };

  // ------------------ STREAM HLS ------------------
  async function initHlsPlayer() {
    const video = document.getElementById("video");
    const status = document.getElementById("status");
    const statusTag = document.getElementById("statusTag");
    if (!video || !status || !statusTag) return;

    try {
      await ensureHlsHelper();
    } catch (err) {
      updateVideoStatus(statusTag, status, "error", err?.message || "No pude preparar el helper HLS");
      return;
    }
    if (!window.OGAAC_HLS) {
      updateVideoStatus(statusTag, status, "error", "No hay helper HLS disponible");
      return;
    }

    const diag = ensureVideoDiagnostics();
    if (hlsController) {
      hlsController.destroy();
    }

    try {
      hlsController = window.OGAAC_HLS.createPlayerController({
        videoEl: video,
        sede: SEDE,
        sala: SALA,
        onStatusChange: (mode, detail) => updateVideoStatus(statusTag, status, mode, detail),
        onDiagnostics: (info) => updateVideoDiag(diag, info),
      });
    } catch (err) {
      const fallbackUrl = window.OGAAC_HLS.buildHlsUrl(SEDE, SALA);
      updateVideoStatus(statusTag, status, "error", err?.message || "HLS no disponible");
      updateVideoDiag(diag, { ok: false, error: err?.message, url: fallbackUrl });
      return;
    }

    updateVideoDiag(diag, { url: hlsController.url });

    if (diag.retryBtn) {
      diag.retryBtn.onclick = () => {
        diag.retryBtn.disabled = true;
        hlsController.refresh({ play: true })
          .catch((err) => updateVideoStatus(statusTag, status, "error", err?.message || "HLS no disponible"))
          .finally(() => { diag.retryBtn.disabled = false; });
      };
    }

    if (diag.playBtn) {
      diag.playBtn.onclick = () => {
        hlsController.manualPlay().catch((err) => {
          updateVideoStatus(statusTag, status, "error", err?.message || "No pude iniciar la reproducción");
        });
      };
    }

    await hlsController.refresh({ play: true }).catch((err) => {
      updateVideoStatus(statusTag, status, "error", err?.message || "HLS no disponible");
    });
  }

  function updateVideoStatus(tagEl, textEl, mode, detail) {
    const labels = {
      checking: "Verificando",
      ready: "Listo",
      live: "En vivo",
      error: "Sin señal",
    };
    tagEl.textContent = labels[mode] || "Sin señal";
    tagEl.classList.remove("status-ok", "status-error");
    if (mode === "live" || mode === "ready") tagEl.classList.add("status-ok");
    if (mode === "error") tagEl.classList.add("status-error");
    textEl.textContent = detail || defaultStatusDetail(mode);
  }

  function defaultStatusDetail(mode) {
    if (mode === "checking") return "Validando HLS de la sala...";
    if (mode === "ready") return "Playlist verificada. Preparando video.";
    if (mode === "live") return "Stream en vivo reproduciéndose.";
    return "No se detecta señal de la sala. Verificar OBS/encoder.";
  }

  function ensureVideoDiagnostics() {
    if (diagControls) return diagControls;
    injectDiagStyles();
    const card = document.querySelector(".card-stream");
    if (!card) return {};
    const wrapper = document.createElement("div");
    wrapper.className = "hls-mini-diag";
    wrapper.innerHTML = `
      <div>
        <strong>HLS</strong>
        <span data-hls-url>—</span>
      </div>
      <div>
        <strong>HTTP</strong>
        <span data-hls-http>—</span>
      </div>
      <div>
        <strong>Mensaje</strong>
        <span data-hls-msg>Validación pendiente</span>
      </div>
      <div class="diag-actions">
        <button type="button" data-hls-retry>Reintentar diagnóstico</button>
        <button type="button" data-hls-play>Forzar reproducción</button>
      </div>
    `;
    card.appendChild(wrapper);
    diagControls = {
      root: wrapper,
      url: wrapper.querySelector('[data-hls-url]'),
      http: wrapper.querySelector('[data-hls-http]'),
      msg: wrapper.querySelector('[data-hls-msg]'),
      retryBtn: wrapper.querySelector('[data-hls-retry]'),
      playBtn: wrapper.querySelector('[data-hls-play]'),
    };
    return diagControls;
  }

  function updateVideoDiag(diag, info = {}) {
    if (!diag) return;
    if (diag.url && (info.url || info.manifest || window.OGAAC_HLS)) {
      const fallbackUrl = window.OGAAC_HLS ? window.OGAAC_HLS.buildHlsUrl(SEDE, SALA) : `/hls/${SEDE}/${SALA}/stream.m3u8`;
      diag.url.textContent = info.url || (info.manifest && info.manifest.url) || fallbackUrl;
    }
    if (diag.http) {
      const manifestStatus = info.manifest && info.manifest.status ? `HTTP ${info.manifest.status}` : null;
      diag.http.textContent = manifestStatus || info.error || "-";
    }
    if (diag.msg) {
      diag.msg.textContent = info.ok ? "Playlist válida" : (info.error || "Sin diagnóstico disponible");
    }
  }

  function injectDiagStyles() {
    if (diagStyleInjected) return;
    const style = document.createElement("style");
    style.textContent = `
      .hls-mini-diag { margin-top:12px; border:1px solid #e5e7eb; border-radius:10px; padding:10px; background:#f8fafc; display:grid; gap:6px; font-size:12px; }
      .hls-mini-diag strong { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#475467; }
      .hls-mini-diag span { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; color:#111827; }
      .hls-mini-diag .diag-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
      .hls-mini-diag .diag-actions button { flex:1; min-width:140px; border-radius:999px; border:1px solid #d1d5db; background:#fff; font-size:12px; padding:6px 10px; cursor:pointer; }
    `;
    document.head.appendChild(style);
    diagStyleInjected = true;
  }

  // ------------------ NAV ------------------
  function wireNavButtons() {
    const btnSede = document.getElementById("btnVolverSede");
    if (btnSede) btnSede.onclick = () => (location.href = `/operador/${SEDE}/`);
  }

  // ------------------ OBS API STATUS BADGE ------------------
  function setObsBadge(text, ok) {
    const el = document.getElementById("obsApiStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "pill " + (ok ? "status-ok" : "status-error");
  }

  // --- Banner de sesión vencida ---
  function showSessionExpiredBanner() {
    let banner = document.getElementById('sessionExpiredBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sessionExpiredBanner';
      banner.style = 'background:#fee; color:#900; padding:16px; text-align:center; font-size:18px; font-weight:bold; border:2px solid #c00; margin:20px 0;';
      banner.innerHTML = 'Sesión vencida o no autorizada. <a href="/login.html" style="color:#900;text-decoration:underline;">Ir a login</a>';
      document.body.prepend(banner);
    }
  }

  // --- Centralizar fetch con credentials ---
  async function apiFetch(url, opts = {}) {
    return fetch(url, { credentials: "include", ...opts });
  }

  let obsStatusInterval = null;
  async function pollObsStatus() {
    const url = `/api/obs/${encodeURIComponent(SEDE)}/${encodeURIComponent(SALA)}/status`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    try {
      const r = await apiFetch(url, { signal: controller.signal });
      if (r.status === 401) {
        setObsBadge("NO AUTORIZADO", false);
        showSessionExpiredBanner();
        if (obsStatusInterval) clearInterval(obsStatusInterval);
        return;
      }
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.ok) {
        const live = !!(j.status && j.status.outputActive);
        setObsBadge(live ? "OBS: OK · EN VIVO" : "OBS: OK · OFF", true);
      } else {
        setObsBadge("OBS: OFF", false);
      }
    } catch {
      setObsBadge("OBS: OFF", false);
    } finally {
      clearTimeout(t);
    }
  }

  // ------------------ OBS LINKS (basic/advanced) ------------------
  function wireObsLinks() {
    // Link Avanzado (sin hardcode)
    const adv = document.getElementById("obsAdvancedLink");
    if (adv) adv.href = "/web-socket-obs/index.html?sede=" + encodeURIComponent(SEDE) + "&sala=" + encodeURIComponent(SALA);

    // Link Básico (si existe en el HTML)
    const basic = document.getElementById("obsBasicLink");
    if (basic) basic.href = "/web-socket-obs/basic.html?sede=" + encodeURIComponent(SEDE) + "&sala=" + encodeURIComponent(SALA);
  }

  // ------------------ INIT ------------------
  window.addEventListener("DOMContentLoaded", async () => {
    wireNavButtons();
    wireObsLinks();
    await checkAuthOrRedirect();
    
    // Inicializar RBAC (debe ir antes de initHlsPlayer para ocultar controles)
    await initRBAC();
    
    initHlsPlayer();
    // OBS badge (si existe en el HTML)
    await pollObsStatus();
    obsStatusInterval = setInterval(pollObsStatus, 2500);
  });
})();
