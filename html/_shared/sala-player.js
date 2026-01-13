(function (window) {
  const cfg = window.SALA_PAGE || {};
  if (!cfg.sede || !cfg.sala) {
    console.error("[sala-player] Falta window.SALA_PAGE {sede,sala}");
    return;
  }
  if (!window.OGAAC_HLS) {
    console.error("[sala-player] OGAAC_HLS no está disponible");
    return;
  }

  const videoEl = document.getElementById("video");
  const statusEl = document.getElementById("status");
  const statusTagEl = document.getElementById("statusTag");
  if (!videoEl || !statusEl || !statusTagEl) {
    console.error("[sala-player] Falta video/status en el DOM");
    return;
  }

  const diagEls = {
    url: document.getElementById("diag-url"),
    http: document.getElementById("diag-http"),
    ctype: document.getElementById("diag-ctype"),
    segment: document.getElementById("diag-segment"),
    segmentHttp: document.getElementById("diag-segment-http"),
    updated: document.getElementById("diag-updated"),
    message: document.getElementById("diag-message"),
    preview: document.getElementById("diag-preview"),
  };

  const retryBtn = document.getElementById("btn-retry");
  const playBtn = document.getElementById("btn-play");

  const hlsOverride = cfg.hlsOverride || new URLSearchParams(window.location.search).get("hls");

  let controller;
  try {
    controller = window.OGAAC_HLS.createPlayerController({
      videoEl,
      sede: cfg.sede,
      sala: cfg.sala,
      urlOverride: hlsOverride,
      onStatusChange: handleStatus,
      onDiagnostics: handleDiagnostics,
    });
  } catch (err) {
    console.error("[sala-player] No pude crear el controller", err);
    handleStatus("error", err.message || "HLS no disponible");
    return;
  }

  updateDiagUrl(controller.url);

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      runValidation();
    });
  }

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      controller.manualPlay().catch((err) => {
        handleStatus("error", err?.message || "No pude iniciar la reproducción");
      });
    });
  }

  runValidation();

  async function runValidation() {
    try {
      await controller.refresh({ play: true });
    } catch (err) {
      handleStatus("error", err?.message || "HLS no disponible");
    }
  }

  function handleStatus(mode, detail) {
    const labelMap = {
      checking: "Verificando",
      ready: "Listo",
      live: "En vivo",
      error: "Sin señal",
    };
    statusTagEl.textContent = labelMap[mode] || "Sin señal";
    statusEl.textContent = detail || defaultDetail(mode);
    statusTagEl.classList.remove("status-ok", "status-error");
    if (mode === "live" || mode === "ready") {
      statusTagEl.classList.add("status-ok");
    }
    if (mode === "error") {
      statusTagEl.classList.add("status-error");
    }
  }

  function defaultDetail(mode) {
    if (mode === "checking") return "Validando playlist...";
    if (mode === "ready") return "Playlist validada. Preparando reproducción.";
    if (mode === "live") return `Reproduciendo ${cfg.label || cfg.sala}.`;
    return "No se detecta señal de la sala.";
  }

  function updateDiagUrl(url) {
    if (diagEls.url) {
      diagEls.url.textContent = url || window.OGAAC_HLS.buildHlsUrl(cfg.sede, cfg.sala);
    }
  }

  function handleDiagnostics(diag) {
    if (!diag) return;
    updateDiagUrl(diag.url);
    if (diagEls.http) {
      diagEls.http.textContent = diag.manifest && diag.manifest.status
        ? `HTTP ${diag.manifest.status}`
        : (diag.error || "-");
    }
    if (diagEls.ctype) {
      diagEls.ctype.textContent = diag.manifest && diag.manifest.contentType
        ? diag.manifest.contentType
        : "-";
    }
    if (diagEls.segment) {
      diagEls.segment.textContent = diag.segment && diag.segment.url ? diag.segment.url : "-";
    }
    if (diagEls.segmentHttp) {
      diagEls.segmentHttp.textContent = diag.segment && diag.segment.status
        ? `HTTP ${diag.segment.status}`
        : "-";
    }
    if (diagEls.updated) {
      diagEls.updated.textContent = new Date().toLocaleTimeString();
    }
    if (diagEls.message) {
      diagEls.message.textContent = diag.ok
        ? "Manifiesto y segmento validados"
        : (diag.error || "No se pudo validar el HLS");
    }
    if (diagEls.preview) {
      diagEls.preview.textContent = diag.manifest && diag.manifest.preview
        ? diag.manifest.preview
        : "(sin datos)";
    }
  }
})(window);
