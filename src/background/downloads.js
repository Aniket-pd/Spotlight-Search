import { normalizeDownloadItem, DOWNLOAD_INDEX_LIMIT } from "../search/downloads.js";

const STREAM_PORT_NAME = "downloads-stream";
const REBUILD_DELAY_MS = 1200;

export function createDownloadService({ context }) {
  const ports = new Set();
  const cache = new Map();
  const metrics = new Map();
  let preloadPromise = null;

  async function ensureCacheLoaded() {
    if (cache.size || preloadPromise) {
      if (preloadPromise) {
        try {
          await preloadPromise;
        } catch (err) {
          // ignore
        }
      }
      return;
    }
    preloadPromise = chrome.downloads
      .search({ limit: DOWNLOAD_INDEX_LIMIT, orderBy: ["-startTime"] })
      .then((items) => {
        for (const item of items) {
          const normalized = normalizeDownloadItem(item);
          if (!normalized) continue;
          seedMetrics(normalized);
          cache.set(normalized.downloadId, normalized);
        }
      })
      .catch((err) => {
        console.warn("Spotlight: failed to preload downloads", err);
      })
      .finally(() => {
        preloadPromise = null;
      });
    await preloadPromise;
  }

  function seedMetrics(download) {
    metrics.set(download.downloadId, {
      bytes: download.bytesReceived || 0,
      timestamp: Date.now(),
      speed: 0,
    });
  }

  function computeMetrics(download, { update = true } = {}) {
    const progress = download.totalBytes > 0
      ? Math.min(1, Math.max(0, download.bytesReceived / download.totalBytes))
      : download.state === "complete"
      ? 1
      : 0;

    const entry = metrics.get(download.downloadId);
    const now = Date.now();
    let speed = entry?.speed || 0;

    if (download.state === "in_progress") {
      if (download.paused) {
        speed = 0;
        if (update) {
          metrics.set(download.downloadId, {
            bytes: download.bytesReceived,
            timestamp: now,
            speed,
          });
        }
      } else if (update) {
        if (entry) {
          const deltaBytes = download.bytesReceived - entry.bytes;
          const deltaTime = now - entry.timestamp;
          if (deltaTime > 0 && deltaBytes >= 0) {
            speed = deltaBytes * 1000 / deltaTime;
          }
        } else {
          speed = 0;
        }
        metrics.set(download.downloadId, {
          bytes: download.bytesReceived,
          timestamp: now,
          speed,
        });
      }
    } else {
      if (update) {
        metrics.delete(download.downloadId);
      }
      speed = 0;
    }

    const remainingBytes = download.totalBytes > 0 ? Math.max(0, download.totalBytes - download.bytesReceived) : null;
    const eta = speed > 0 && remainingBytes !== null ? remainingBytes / speed : null;

    return { progress, speed, eta };
  }

  function updateCache(download) {
    cache.set(download.downloadId, download);
  }

  function maybeScheduleRebuild(download) {
    if (!context || typeof context.scheduleRebuild !== "function") {
      return;
    }
    if (download.state === "complete" || download.state === "interrupted") {
      context.scheduleRebuild(REBUILD_DELAY_MS);
    }
  }

  function broadcast(message) {
    ports.forEach((port) => {
      try {
        port.postMessage(message);
      } catch (err) {
        console.warn("Spotlight: failed to post download message", err);
      }
    });
  }

  function emitUpdate(download, { updateMetrics = true } = {}) {
    if (!download) {
      return;
    }
    const metricsSnapshot = computeMetrics(download, { update: updateMetrics });
    const payload = {
      type: "download-update",
      download: { ...download, progress: metricsSnapshot.progress },
      metrics: metricsSnapshot,
      timestamp: Date.now(),
    };
    broadcast(payload);
  }

  async function refreshDownload(downloadId) {
    try {
      const matches = await chrome.downloads.search({ id: downloadId });
      const item = Array.isArray(matches) ? matches[0] : null;
      const normalized = normalizeDownloadItem(item);
      if (!normalized) {
        return null;
      }
      if (!metrics.has(normalized.downloadId)) {
        seedMetrics(normalized);
      }
      updateCache(normalized);
      return normalized;
    } catch (err) {
      console.warn("Spotlight: failed to refresh download", err);
      return null;
    }
  }

  async function handleAction(action, downloadId) {
    if (typeof downloadId !== "number") {
      throw new Error("Missing download id");
    }
    try {
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
        case "open":
          await chrome.downloads.open(downloadId);
          break;
        case "show":
          await chrome.downloads.show(downloadId);
          break;
        default:
          throw new Error(`Unknown download action: ${action}`);
      }
    } catch (err) {
      console.warn("Spotlight: download action failed", action, err);
      throw err;
    }
    const updated = await refreshDownload(downloadId);
    if (updated) {
      emitUpdate(updated, { updateMetrics: false });
    }
  }

  function handlePortConnection(port) {
    if (port.name !== STREAM_PORT_NAME) {
      return;
    }
    ports.add(port);
    ensureCacheLoaded()
      .then(() => {
        const snapshot = [];
        cache.forEach((download) => {
          if (!metrics.has(download.downloadId)) {
            seedMetrics(download);
          }
          const metricsSnapshot = computeMetrics(download, { update: false });
          snapshot.push({
            download: { ...download, progress: metricsSnapshot.progress },
            metrics: metricsSnapshot,
            timestamp: Date.now(),
          });
        });
        port.postMessage({ type: "download-snapshot", downloads: snapshot });
      })
      .catch((err) => {
        console.warn("Spotlight: failed to send download snapshot", err);
      });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  }

  chrome.runtime.onConnect.addListener(handlePortConnection);

  chrome.downloads.onCreated.addListener((item) => {
    const normalized = normalizeDownloadItem(item);
    if (!normalized) {
      return;
    }
    seedMetrics(normalized);
    updateCache(normalized);
    emitUpdate(normalized);
    maybeScheduleRebuild(normalized);
  });

  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || typeof delta.id !== "number") {
      return;
    }
    refreshDownload(delta.id).then((normalized) => {
      if (!normalized) {
        return;
      }
      emitUpdate(normalized);
      maybeScheduleRebuild(normalized);
    });
  });

  chrome.downloads.onErased.addListener((downloadId) => {
    if (cache.has(downloadId)) {
      cache.delete(downloadId);
    }
    if (metrics.has(downloadId)) {
      metrics.delete(downloadId);
    }
    broadcast({ type: "download-removed", downloadId });
    if (context && typeof context.scheduleRebuild === "function") {
      context.scheduleRebuild(REBUILD_DELAY_MS);
    }
  });

  ensureCacheLoaded().catch(() => {
    // already logged inside ensureCacheLoaded
  });

  return {
    handleAction,
    refreshDownload,
  };
}
