const DOWNLOAD_FEED_LIMIT = 200;
const BROADCAST_INTERVAL_MS = 150;

function parseChromeTimestamp(value) {
  if (!value) {
    return 0;
  }
  try {
    return new Date(value).getTime() || 0;
  } catch (err) {
    return 0;
  }
}

function extractFileName(path = "") {
  if (!path) {
    return "";
  }
  const parts = path.split(/[\\/]+/);
  return parts[parts.length - 1] || path;
}

export function createDownloadService({ scheduleRebuild }) {
  const rawDownloads = new Map();
  const streamState = new Map();
  const throttles = new Map();
  const ports = new Set();

  async function primeState() {
    try {
      const downloads = await chrome.downloads.search({ orderBy: ["-startTime"], limit: DOWNLOAD_FEED_LIMIT });
      downloads.forEach((item) => mergeRawDownload(item));
    } catch (err) {
      console.warn("Spotlight: unable to prime download state", err);
    }
  }

  function serializeForPort(entry) {
    if (!entry) {
      return null;
    }
    return {
      downloadId: entry.downloadId,
      state: entry.state,
      paused: entry.paused,
      canResume: entry.canResume,
      bytesReceived: entry.bytesReceived,
      totalBytes: entry.totalBytes,
      speed: entry.speed,
      etaSeconds: entry.etaSeconds,
      progress: entry.progress,
      startTime: entry.startTime,
      endTime: entry.endTime,
      filename: entry.filename,
      filePath: entry.filePath,
      url: entry.url,
      danger: entry.danger,
    };
  }

  function broadcastUpdate(entry) {
    const payload = serializeForPort(entry);
    if (!payload) {
      return;
    }
    ports.forEach((port) => {
      try {
        port.postMessage({ type: "download-update", download: payload });
      } catch (err) {
        console.warn("Spotlight: failed to post download update", err);
      }
    });
  }

  function scheduleBroadcast(downloadId) {
    const state = streamState.get(downloadId);
    if (!state) {
      return;
    }
    const existing = throttles.get(downloadId);
    if (existing && existing.timer) {
      existing.pending = state;
      return;
    }

    const entry = existing || { pending: state, timer: null };
    entry.pending = state;
    entry.timer = setTimeout(() => {
      const current = throttles.get(downloadId);
      throttles.delete(downloadId);
      if (current && current.pending) {
        broadcastUpdate(current.pending);
      }
    }, BROADCAST_INTERVAL_MS);
    throttles.set(downloadId, entry);
  }

  function updateMetrics(raw) {
    const id = raw.id;
    if (typeof id !== "number") {
      return;
    }
    const previous = streamState.get(id) || null;
    const now = Date.now();

    const bytesReceived =
      typeof raw.bytesReceived === "number" ? raw.bytesReceived : previous?.bytesReceived ?? 0;
    const totalBytes = typeof raw.totalBytes === "number" ? raw.totalBytes : previous?.totalBytes ?? 0;

    const lastBytes = previous?.bytesReceived ?? bytesReceived;
    const lastUpdate = previous?.lastUpdateTime ?? now;
    const deltaBytes = bytesReceived - lastBytes;
    const deltaTime = Math.max(0, now - lastUpdate);
    let speed = previous?.speed ?? 0;
    if (deltaTime > 0 && deltaBytes >= 0) {
      const instantaneous = deltaBytes / (deltaTime / 1000 || 1);
      if (Number.isFinite(instantaneous)) {
        speed = instantaneous;
      }
    }

    let etaSeconds = null;
    if (speed > 0 && totalBytes > 0 && bytesReceived < totalBytes) {
      etaSeconds = (totalBytes - bytesReceived) / speed;
    } else if (totalBytes > 0 && bytesReceived >= totalBytes) {
      etaSeconds = 0;
    }

    const state = raw.state || previous?.state || "in_progress";
    const entry = {
      downloadId: id,
      state,
      paused: typeof raw.paused === "boolean" ? raw.paused : Boolean(previous?.paused),
      canResume: typeof raw.canResume === "boolean" ? raw.canResume : Boolean(previous?.canResume),
      bytesReceived,
      totalBytes,
      speed,
      etaSeconds,
      progress: totalBytes > 0 ? Math.min(1, bytesReceived / totalBytes) : null,
      startTime: raw.startTime ? parseChromeTimestamp(raw.startTime) : previous?.startTime || 0,
      endTime: raw.endTime ? parseChromeTimestamp(raw.endTime) : previous?.endTime || 0,
      filename: raw.filename || previous?.filename || "",
      filePath: raw.filename || previous?.filePath || "",
      url: raw.finalUrl || raw.url || previous?.url || "",
      danger: raw.danger || previous?.danger || "safe",
      lastUpdateTime: now,
    };

    if (!entry.filename && entry.filePath) {
      entry.filename = extractFileName(entry.filePath);
    }

    streamState.set(id, entry);
    scheduleBroadcast(id);
  }

  function mergeRawDownload(download) {
    if (!download || typeof download.id !== "number") {
      return;
    }
    const existing = rawDownloads.get(download.id) || {};
    const merged = {
      ...existing,
      ...download,
      id: download.id,
    };
    rawDownloads.set(download.id, merged);
    updateMetrics(merged);
  }

  function mergeDelta(delta) {
    if (!delta || typeof delta.id !== "number") {
      return;
    }
    const existing = rawDownloads.get(delta.id) || { id: delta.id };
    const merged = { ...existing };
    if (delta.state && typeof delta.state.current === "string") {
      merged.state = delta.state.current;
    }
    if (delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
      merged.bytesReceived = delta.bytesReceived.current;
    }
    if (delta.totalBytes && typeof delta.totalBytes.current === "number") {
      merged.totalBytes = delta.totalBytes.current;
    }
    if (delta.paused && typeof delta.paused.current === "boolean") {
      merged.paused = delta.paused.current;
    }
    if (delta.canResume && typeof delta.canResume.current === "boolean") {
      merged.canResume = delta.canResume.current;
    }
    if (delta.filename && typeof delta.filename.current === "string") {
      merged.filename = delta.filename.current;
    }
    if (delta.mime && typeof delta.mime.current === "string") {
      merged.mime = delta.mime.current;
    }
    if (delta.danger && typeof delta.danger.current === "string") {
      merged.danger = delta.danger.current;
    }
    if (delta.endTime && typeof delta.endTime.current === "string") {
      merged.endTime = delta.endTime.current;
    }
    if (delta.exists && typeof delta.exists.current === "boolean") {
      merged.exists = delta.exists.current;
    }
    rawDownloads.set(delta.id, merged);
    updateMetrics(merged);
  }

  chrome.downloads.onCreated.addListener((downloadItem) => {
    mergeRawDownload(downloadItem);
    scheduleRebuild?.(1200);
  });

  chrome.downloads.onChanged.addListener((delta) => {
    mergeDelta(delta);
    const newState = delta?.state?.current;
    if (newState === "complete" || newState === "interrupted") {
      scheduleRebuild?.(900);
    }
  });

  primeState();

  function handlePortConnection(port) {
    ports.add(port);
    const snapshot = Array.from(streamState.values())
      .map(serializeForPort)
      .filter(Boolean);
    if (snapshot.length) {
      try {
        port.postMessage({ type: "downloads-snapshot", downloads: snapshot });
      } catch (err) {
        console.warn("Spotlight: failed to deliver downloads snapshot", err);
      }
    }
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  }

  async function handleAction(downloadId, action) {
    if (typeof downloadId !== "number") {
      throw new Error("Invalid download id");
    }
    switch (action) {
      case "pause":
        await chrome.downloads.pause(downloadId);
        break;
      case "resume":
        await chrome.downloads.resume(downloadId);
        break;
      case "cancel":
        await chrome.downloads.cancel(downloadId);
        break;
      case "show":
        await chrome.downloads.show(downloadId);
        break;
      default:
        throw new Error(`Unsupported download action: ${action}`);
    }
  }

  return {
    handlePortConnection,
    handleAction,
  };
}

export function registerDownloadRuntimeHooks(service) {
  if (!service) {
    return;
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "downloads-stream") {
      service.handlePortConnection(port);
    }
  });
}
