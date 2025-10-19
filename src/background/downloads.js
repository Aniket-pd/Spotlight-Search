const STREAM_PORT_NAME = "downloads-stream";
const BROADCAST_INTERVAL = 150;
const SPEED_SAMPLE_MIN_INTERVAL = 120;

function extractFilename(path = "") {
  if (!path) return "";
  const parts = path.split(/\\|\//).filter(Boolean);
  if (!parts.length) {
    return path.trim();
  }
  return parts[parts.length - 1] || "";
}

function extractDirectory(path = "") {
  if (!path) return "";
  const parts = path.split(/\\|\//).filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  return parts[parts.length - 2] || "";
}

function parseChromeTime(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toClientPayload(record) {
  if (!record) {
    return null;
  }
  const { lastSampleTime, lastSent, ...rest } = record;
  return { ...rest };
}

function createNormalizedRecord(item, previous) {
  if (!item || typeof item.id !== "number") {
    return null;
  }

  const now = Date.now();
  const bytesReceived = Number.isFinite(item.bytesReceived) ? item.bytesReceived : Number(item.bytesReceived) || 0;
  const totalBytes = Number.isFinite(item.totalBytes) ? item.totalBytes : Number(item.totalBytes) || 0;
  const state = (item.state || "in_progress").toLowerCase();
  const startTime = parseChromeTime(item.startTime);
  const endTime = parseChromeTime(item.endTime);
  const completedAt = endTime || (state === "complete" ? startTime : 0);
  const createdAt = completedAt || startTime || now;
  const fileUrl = item.url || "";
  const url = item.finalUrl || fileUrl;
  const filename = extractFilename(item.filename || item.suggestedFilename || "");
  const displayPath = extractDirectory(item.filename || "");

  const normalized = {
    id: item.id,
    downloadId: item.id,
    state,
    paused: Boolean(item.paused),
    canResume: Boolean(item.canResume),
    danger: item.danger || "safe",
    exists: item.exists !== false,
    bytesReceived,
    totalBytes,
    progressPercent: totalBytes > 0 ? clampPercent(bytesReceived / totalBytes) : null,
    speedBps: previous?.speedBps || 0,
    etaSeconds: previous?.etaSeconds ?? null,
    lastSampleTime: previous?.lastSampleTime || now,
    lastSent: previous?.lastSent || 0,
    startTime,
    endTime,
    createdAt,
    completedAt,
    fileUrl,
    url,
    filename,
    displayPath,
    referrer: item.referrer || "",
    byExtensionName: item.byExtensionName || "",
    mime: item.mime || "",
  };

  const elapsedMs = now - normalized.lastSampleTime;
  const deltaBytes = bytesReceived - (previous?.bytesReceived ?? bytesReceived);
  if (deltaBytes >= 0 && elapsedMs >= SPEED_SAMPLE_MIN_INTERVAL) {
    const seconds = elapsedMs / 1000;
    if (seconds > 0) {
      const speed = deltaBytes / seconds;
      if (Number.isFinite(speed) && speed >= 0) {
        normalized.speedBps = speed;
      }
    }
    normalized.lastSampleTime = now;
  }

  if (normalized.speedBps > 0 && totalBytes > 0 && bytesReceived < totalBytes) {
    normalized.etaSeconds = Math.max((totalBytes - bytesReceived) / normalized.speedBps, 0);
  } else if (state === "complete") {
    normalized.etaSeconds = 0;
  } else if (!Number.isFinite(normalized.speedBps) || normalized.speedBps <= 0) {
    normalized.etaSeconds = null;
  }

  return normalized;
}

export function createDownloadService({ context } = {}) {
  const ports = new Set();
  const cache = new Map();

  function broadcast(message) {
    ports.forEach((port) => {
      try {
        port.postMessage(message);
      } catch (err) {
        console.warn("Spotlight: failed to deliver download update", err);
      }
    });
  }

  function upsertRecord(item, { force = false } = {}) {
    const previous = cache.get(item.id) || null;
    const normalized = createNormalizedRecord(item, previous);
    if (!normalized) {
      return;
    }
    const now = Date.now();
    cache.set(item.id, normalized);

    const progressChanged = Math.abs((normalized.progressPercent || 0) - (previous?.progressPercent || 0)) >= 0.005;
    const speedChanged = Math.abs((normalized.speedBps || 0) - (previous?.speedBps || 0)) >= 256;
    const etaChanged =
      (Number.isFinite(normalized.etaSeconds) || Number.isFinite(previous?.etaSeconds)) &&
      Math.abs((normalized.etaSeconds || 0) - (previous?.etaSeconds || 0)) >= 0.5;
    const stateChanged = normalized.state !== previous?.state || normalized.paused !== previous?.paused;
    const existsChanged = normalized.exists !== previous?.exists;
    const shouldSend =
      force ||
      !previous ||
      stateChanged ||
      existsChanged ||
      progressChanged ||
      speedChanged ||
      etaChanged ||
      now - (previous?.lastSent || 0) >= BROADCAST_INTERVAL;

    if (shouldSend) {
      normalized.lastSent = now;
      cache.set(item.id, normalized);
      if (ports.size) {
        const payload = toClientPayload(normalized);
        if (payload) {
          broadcast({ type: "download-update", download: payload });
        }
      }
    }
  }

  function removeRecord(downloadId) {
    const previous = cache.get(downloadId);
    cache.delete(downloadId);
    if (previous && ports.size) {
      const payload = { ...previous, state: "erased", exists: false };
      broadcast({ type: "download-update", download: toClientPayload(payload) });
    }
  }

  async function handleChanged(delta) {
    if (!delta || typeof delta.id !== "number") {
      return;
    }
    try {
      const results = await chrome.downloads.search({ id: delta.id });
      if (!Array.isArray(results) || !results.length) {
        return;
      }
      const item = results[0];
      const force = Boolean(delta.state || delta.endTime || delta.exists || delta.filename);
      upsertRecord(item, { force });
      if (force && context?.scheduleRebuild) {
        context.scheduleRebuild(500);
      }
    } catch (err) {
      console.warn("Spotlight: download change lookup failed", err);
    }
  }

  function handleCreated(item) {
    upsertRecord(item, { force: true });
    if (context?.scheduleRebuild) {
      context.scheduleRebuild(400);
    }
  }

  async function initializeCache() {
    if (!chrome.downloads || typeof chrome.downloads.search !== "function") {
      return;
    }
    try {
      const downloads = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 200 });
      downloads.forEach((item) => {
        upsertRecord(item, { force: false });
      });
    } catch (err) {
      console.warn("Spotlight: unable to prime download cache", err);
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== STREAM_PORT_NAME) {
      return;
    }
    ports.add(port);
    const payload = Array.from(cache.values())
      .map((record) => toClientPayload(record))
      .filter(Boolean);
    if (payload.length) {
      try {
        port.postMessage({ type: "download-batch", downloads: payload });
      } catch (err) {
        console.warn("Spotlight: failed to deliver download batch", err);
      }
    }
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  });

  chrome.downloads.onCreated.addListener(handleCreated);
  chrome.downloads.onChanged.addListener(handleChanged);
  chrome.downloads.onErased.addListener((downloadId) => {
    removeRecord(downloadId);
    if (context?.scheduleRebuild) {
      context.scheduleRebuild(600);
    }
  });

  initializeCache();

  async function performAction(downloadId, action) {
    if (typeof downloadId !== "number") {
      throw new Error("Invalid download id");
    }
    const normalizedAction = (action || "").toLowerCase();
    try {
      switch (normalizedAction) {
        case "open":
          await chrome.downloads.open(downloadId);
          break;
        case "show":
          await chrome.downloads.show(downloadId);
          break;
        case "pause":
          await chrome.downloads.pause(downloadId);
          break;
        case "resume":
          await chrome.downloads.resume(downloadId);
          break;
        case "cancel":
          await chrome.downloads.cancel(downloadId);
          break;
        default:
          throw new Error(`Unsupported download action: ${action}`);
      }
    } catch (err) {
      console.warn("Spotlight: download action failed", err);
      throw err;
    }
  }

  function getCached(downloadId) {
    const record = cache.get(downloadId);
    return record ? toClientPayload(record) : null;
  }

  return {
    performAction,
    getCached,
  };
}
