import OBSWebSocket from "obs-websocket-js";

const obs = new OBSWebSocket();

const OBS_CONFIG = {
  url: "ws://10.64.206.55:4455",
  password: "sala10test",
};

export async function getSala10Status() {
  try {
    await obs.connect(OBS_CONFIG.url, OBS_CONFIG.password);
    const status = await obs.call("GetStreamStatus");
    await obs.disconnect();
    return { ok: true, status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
