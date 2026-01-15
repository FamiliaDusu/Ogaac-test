const OBSWebSocket = require("obs-websocket-js").default;

const OBS_CONFIG = {
  url: "ws://10.64.206.55:4455",
  password: "sala10test",
};

async function getSala10Status() {
  const obs = new OBSWebSocket();

  try {
    await obs.connect(OBS_CONFIG.url, OBS_CONFIG.password);
    const status = await obs.call("GetStreamStatus");
    await obs.disconnect();
    return { ok: true, status };
  } catch (error) {
    try { await obs.disconnect(); } catch (_) {}
    return { ok: false, error: error.message || String(error) };
  }
}

module.exports = { getSala10Status };
