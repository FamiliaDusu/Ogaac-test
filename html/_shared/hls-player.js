(function (window) {
  if (window.OGAAC_HLS) {
    return;
  }

  const DEFAULT_TIMEOUT = 5000;

  function canonicalSalaId(raw) {
    if (raw === undefined || raw === null) return "";
    const text = String(raw).trim().toLowerCase();
    const match = text.match(/^(?:sala)?0*(\d+)$/);
    if (match) return `sala${parseInt(match[1], 10)}`;
    return text || "";
  }

  function buildHlsUrl(sede, sala) {
    if (!sede || !sala) return "";
    const normSede = String(sede).trim().toLowerCase();
    const normSala = canonicalSalaId(sala);
    if (!normSala) return "";
    return `/hls/${normSede}/${normSala}/stream.m3u8`;
  }

  function cacheBust(url) {
    if (!url) return "";
    const token = `_ts=${Date.now()}`;
    return url.includes("?") ? `${url}&${token}` : `${url}?${token}`;
  }

  function withTimeout(options = {}, timeoutMs = DEFAULT_TIMEOUT) {
    const final = { ...options };
    if (final.signal) {
      return { options: final, cleanup: () => {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    final.signal = controller.signal;
    return {
      options: final,
      cleanup: () => clearTimeout(timer),
    };
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
    const { options: finalOptions, cleanup } = withTimeout(options, timeoutMs);
    try {
      const res = await fetch(url, finalOptions);
      cleanup();
      return res;
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  async function headHls(url, opts = {}) {
    if (!url) throw new Error("URL HLS requerida");
    const timeoutMs = opts.timeoutMs || 4000;
    const result = { url };
    try {
      const res = await fetchWithTimeout(cacheBust(url), {
        method: "HEAD",
        cache: "no-store",
      }, timeoutMs);
      result.ok = res.ok;
      result.status = res.status;
      result.statusText = res.statusText;
      result.contentType = res.headers.get("content-type") || "";
      return result;
    } catch (err) {
      result.ok = false;
      result.error = err.name === "AbortError" ? "timeout" : (err.message || "error HEAD");
      return result;
    }
  }

  async function probeHls(url, opts = {}) {
    if (!url) throw new Error("URL HLS requerida");
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
    const diag = {
      ok: false,
      url,
      manifest: {},
      segment: {},
    };

    let manifestRes;
    try {
      manifestRes = await fetchWithTimeout(cacheBust(url), {
        method: "GET",
        cache: "no-store",
      }, timeoutMs);
    } catch (err) {
      diag.error = err.name === "AbortError" ? "Timeout al leer manifiesto" : (err.message || "Error al leer manifiesto");
      return diag;
    }

    const manifestText = await manifestRes.text().catch(() => "");
    const trimmed = manifestText.trimStart();
    diag.manifest = {
      status: manifestRes.status,
      statusText: manifestRes.statusText,
      contentType: manifestRes.headers.get("content-type") || "",
      preview: trimmed.slice(0, 200).replace(/\s+/g, " "),
    };

    if (!manifestRes.ok) {
      diag.error = `Manifiesto HTTP ${manifestRes.status}`;
      return diag;
    }
    if (!trimmed.startsWith("#EXTM3U")) {
      diag.error = "El manifiesto no comienza con #EXTM3U";
      return diag;
    }

    const lines = manifestText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const firstSegment = lines.find((line) => !line.startsWith("#"));
    if (!firstSegment) {
      diag.error = "Playlist sin segmentos";
      return diag;
    }

    const base = new URL(url, window.location.origin);
    const segmentUrl = new URL(firstSegment, base);
    diag.segment.url = segmentUrl.href.replace(window.location.origin, "");

    let segmentRes;
    try {
      segmentRes = await fetchWithTimeout(cacheBust(segmentUrl.href), {
        method: "HEAD",
        cache: "no-store",
      }, timeoutMs);
    } catch (err) {
      diag.error = err.name === "AbortError" ? "Timeout al validar segmento" : (err.message || "Error al validar segmento");
      return diag;
    }

    diag.segment.status = segmentRes.status;
    diag.segment.statusText = segmentRes.statusText;
    diag.segment.contentType = segmentRes.headers.get("content-type") || "";
    if (!segmentRes.ok) {
      diag.error = `Segmento HTTP ${segmentRes.status}`;
      return diag;
    }

    diag.ok = true;
    return diag;
  }

  function sanitizeOverride(raw) {
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      return url.pathname + url.search;
    } catch (_) {
      return null;
    }
  }

  function createPlayerController(options = {}) {
    const {
      videoEl,
      sede,
      sala,
      urlOverride,
      autoplay = true,
      timeoutMs = DEFAULT_TIMEOUT,
      onStatusChange,
      onDiagnostics,
    } = options;

    if (!videoEl) {
      throw new Error("videoEl requerido en createPlayerController");
    }

    const resolvedUrl = sanitizeOverride(urlOverride) || buildHlsUrl(sede, sala);
    if (!resolvedUrl) {
      throw new Error("No se pudo resolver la URL HLS");
    }

    let hlsInstance = null;
    
    // ========= AUTO-RETRY CONFIG =========
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [800, 1200, 2000]; // backoff suave
    const NON_FATAL_THROTTLE_MS = 3000; // throttle para errores no-fatales
    let retryCount = 0;
    let retryTimer = null;
    let lastNonFatalRetryTime = 0;

    function emitStatus(mode, detail) {
      if (typeof onStatusChange === "function") {
        onStatusChange(mode, detail);
      }
    }

    function emitDiag(diag) {
      if (typeof onDiagnostics === "function") {
        onDiagnostics(diag);
      }
    }

    function resetRetryCount() {
      if (retryCount > 0) {
        console.log("[HLS] Reset retry count (stream healthy)");
      }
      retryCount = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function destroy() {
      resetRetryCount();
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    }

    function attemptAutoplay() {
      if (!autoplay) return;
      videoEl.play()
        .then(() => emitStatus("live", "Reproduciendo"))
        .catch(() => emitStatus("ready", "Autoplay bloqueado"));
    }

    // ========= AUTO-RETRY LOGIC =========
    function isFragmentLoadError(data) {
      // Detectar error de carga de fragmento/segmento (cualquier HTTP error)
      if (!data) return false;
      
      // HLS.js usa Hls.ErrorTypes.NETWORK_ERROR (string "networkError")
      // y Hls.ErrorDetails como fragLoadError, fragLoadTimeOut, etc.
      const fragDetails = [
        "fragLoadError",
        "fragLoadTimeOut", 
        "fragParsingError",
        "fragDecryptError"
      ];
      
      const isFragError = fragDetails.includes(data.details);
      
      // Detectar código HTTP 404 en múltiples ubicaciones posibles
      const httpStatus = data.response?.code || 
                         data.frag?.response?.code ||
                         data.networkDetails?.status ||
                         data.response?.status ||
                         null;
      
      const is404 = httpStatus === 404;
      
      // Log para debugging
      if (isFragError) {
        console.warn(`[HLS] Fragment error: details=${data.details}, fatal=${data.fatal}, httpStatus=${httpStatus}`, data);
      }
      
      return isFragError && is404;
    }

    function shouldRetryNonFatal() {
      // Throttle para evitar loops en errores no-fatales
      const now = Date.now();
      if (now - lastNonFatalRetryTime < NON_FATAL_THROTTLE_MS) {
        return false;
      }
      lastNonFatalRetryTime = now;
      return true;
    }

    function scheduleAutoRetry(reason = "error") {
      if (retryCount >= MAX_RETRIES) {
        emitStatus("error", `Falló después de ${MAX_RETRIES} reintentos. Use el botón para reintentar.`);
        return;
      }

      const delay = RETRY_DELAYS[retryCount] || 2000;
      retryCount++;
      
      console.log(`[HLS] Scheduling auto-retry ${retryCount}/${MAX_RETRIES} in ${delay}ms (reason: ${reason})`);
      emitStatus("checking", `Auto-reintento ${retryCount}/${MAX_RETRIES}…`);
      
      retryTimer = setTimeout(async () => {
        try {
          // Destruir instancia actual de forma segura
          if (hlsInstance) {
            try {
              hlsInstance.stopLoad();
              hlsInstance.detachMedia();
            } catch (_) { /* ignore */ }
            hlsInstance.destroy();
            hlsInstance = null;
          }
          // Reiniciar con cache-bust fresco
          await startPlayback(resolvedUrl);
        } catch (err) {
          console.error("[HLS] Retry failed:", err);
          // Si falla el retry, intentar de nuevo o rendirse
          if (retryCount < MAX_RETRIES) {
            scheduleAutoRetry("retry-failed");
          } else {
            emitStatus("error", `Falló después de ${MAX_RETRIES} reintentos.`);
          }
        }
      }, delay);
    }

    function handleHlsError(event, data) {
      if (!data) return;
      
      const isFragError = isFragmentLoadError(data);
      
      // Caso 1: Error fatal de fragmento 404 -> auto-retry
      if (data.fatal && isFragError) {
        console.warn("[HLS] Fatal fragment 404, attempting auto-recovery...");
        scheduleAutoRetry("fatal-frag-404");
        return;
      }
      
      // Caso 2: Error NO fatal de fragmento 404 -> auto-retry con throttle
      // (HLS.js a veces marca 404 como no-fatal pero igual rompe el playback)
      if (!data.fatal && isFragError && shouldRetryNonFatal()) {
        console.warn("[HLS] Non-fatal fragment 404, attempting recovery...");
        scheduleAutoRetry("non-fatal-frag-404");
        return;
      }
      
      // Caso 3: Otros errores fatales -> destruir y reportar
      if (data.fatal) {
        console.error("[HLS] Fatal error (non-recoverable):", data.type, data.details);
        destroy();
        emitStatus("error", `HLS fatal (${data.details || data.type || "desconocido"})`);
      }
    }

    function setupHlsEventHandlers() {
      if (!hlsInstance || !window.Hls) return;
      
      // Error handler
      hlsInstance.on(window.Hls.Events.ERROR, handleHlsError);
      
      // Reset retry count cuando el stream está sano
      hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        console.log("[HLS] Manifest parsed successfully");
        resetRetryCount();
        attemptAutoplay();
      });
      
      hlsInstance.on(window.Hls.Events.LEVEL_LOADED, () => {
        // Stream está cargando niveles = está sano
        resetRetryCount();
      });
      
      hlsInstance.on(window.Hls.Events.FRAG_LOADED, () => {
        // Fragmento cargado exitosamente = stream sano
        resetRetryCount();
      });
    }

    // También resetear cuando el video entra en playing
    function setupVideoEventHandlers() {
      videoEl.addEventListener("playing", () => {
        console.log("[HLS] Video playing");
        resetRetryCount();
      });
    }

    // Setup inicial de eventos del video
    setupVideoEventHandlers();

    async function startPlayback(playUrl) {
      const cacheSafeUrl = cacheBust(playUrl);
      console.log("[HLS] Starting playback:", cacheSafeUrl);
      
      if (window.Hls && window.Hls.isSupported()) {
        // Limpiar instancia anterior si existe
        if (hlsInstance) {
          hlsInstance.destroy();
          hlsInstance = null;
        }
        
        hlsInstance = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          // Config adicional para mejor recovery
          fragLoadingMaxRetry: 2,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
        });
        
        setupHlsEventHandlers();
        hlsInstance.loadSource(cacheSafeUrl);
        hlsInstance.attachMedia(videoEl);
      } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        destroy();
        videoEl.src = cacheSafeUrl;
        videoEl.addEventListener("loadedmetadata", attemptAutoplay, { once: true });
        videoEl.addEventListener("error", () => emitStatus("error", "Error nativo al reproducir"), { once: true });
      } else {
        throw new Error("El navegador no soporta HLS");
      }
    }

    async function refresh({ play = true } = {}) {
      emitStatus("checking", "Validando HLS...");
      let diag;
      try {
        diag = await probeHls(resolvedUrl, { timeoutMs });
      } catch (err) {
        diag = { ok: false, url: resolvedUrl, error: err.message || "Error al validar HLS" };
      }

      emitDiag(diag);
      if (!diag.ok) {
        destroy();
        emitStatus("error", diag.error || "HLS no disponible");
        throw new Error(diag.error || "HLS no disponible");
      }

      emitStatus("ready", "Playlist válida");
      if (play) {
        await startPlayback(resolvedUrl);
      }
      return diag;
    }

    function manualPlay() {
      return videoEl.play();
    }

    return {
      url: resolvedUrl,
      refresh,
      destroy,
      manualPlay,
    };
  }

  window.OGAAC_HLS = {
    canonicalSalaId,
    buildHlsUrl,
    cacheBust,
    headHls,
    probeHls,
    createPlayerController,
  };
})(window);
