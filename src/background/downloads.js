const POLL_INTERVAL_MS = 800;

function computeProgress(bytesReceived, totalBytes) {
  if (typeof totalBytes !== "number" || totalBytes <= 0) {
    return null;
  }
  if (typeof bytesReceived !== "number" || bytesReceived < 0) {
    return 0;
  }
  return Math.min(1, bytesReceived / totalBytes);
}

function parseChromeTime(value) {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function registerDownloadListeners({ context }) {
  if (!chrome?.downloads) {
    return;
  }

  const speedSamples = new Map();
  const activeDownloads = new Set();
  let pollTimer = null;
  let pollInFlight = false;

  function recordSpeedSample(downloadId, bytesReceived) {
    const now = Date.now();
    const previous = speedSamples.get(downloadId);
    speedSamples.set(downloadId, { bytesReceived, timestamp: now });
    if (!previous) {
      return null;
    }
    const deltaBytes = bytesReceived - (previous.bytesReceived || 0);
    const deltaMs = now - previous.timestamp;
    if (deltaBytes <= 0 || deltaMs <= 0) {
      return null;
    }
    return (deltaBytes * 1000) / deltaMs;
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function ensurePolling() {
    if (pollTimer || pollInFlight || !activeDownloads.size) {
      return;
    }
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!activeDownloads.size) {
        return;
      }
      pollInFlight = true;
      try {
        const ids = Array.from(activeDownloads);
        await Promise.all(ids.map((id) => refreshDownload(id)));
      } finally {
        pollInFlight = false;
        if (activeDownloads.size) {
          ensurePolling();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  function updateActiveDownloads(downloadId, payload) {
    const state = payload?.state || "";
    const isInProgress = state === "in_progress" && !payload?.paused;
    if (isInProgress) {
      activeDownloads.add(downloadId);
      ensurePolling();
      return;
    }
    if (activeDownloads.delete(downloadId)) {
      speedSamples.delete(downloadId);
    }
    if (!activeDownloads.size) {
      stopPolling();
    }
  }

  async function refreshDownload(downloadId) {
    if (typeof downloadId !== "number") {
      return;
    }
    try {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (!item) {
        activeDownloads.delete(downloadId);
        speedSamples.delete(downloadId);
        if (!activeDownloads.size) {
          stopPolling();
        }
        return;
      }

      const bytesReceived = typeof item.bytesReceived === "number" ? item.bytesReceived : 0;
      const totalBytes = typeof item.totalBytes === "number" && item.totalBytes >= 0 ? item.totalBytes : null;
      const progress = computeProgress(bytesReceived, totalBytes);
      const startedAt = parseChromeTime(item.startTime);
      const completedAt = item.state === "complete" ? parseChromeTime(item.endTime) : 0;
      const estimatedEndTime = item.estimatedEndTime ? parseChromeTime(item.estimatedEndTime) : 0;
      const speed = recordSpeedSample(downloadId, bytesReceived);
      const remaining = totalBytes && totalBytes > bytesReceived ? totalBytes - bytesReceived : null;
      let etaSeconds = speed && remaining ? remaining / speed : null;
      if ((!etaSeconds || !Number.isFinite(etaSeconds)) && estimatedEndTime > 0) {
        const now = Date.now();
        if (estimatedEndTime > now) {
          etaSeconds = (estimatedEndTime - now) / 1000;
        }
      }
      let speedBytesPerSecond = speed;
      if ((!speedBytesPerSecond || !Number.isFinite(speedBytesPerSecond)) && etaSeconds && etaSeconds > 0 && remaining) {
        speedBytesPerSecond = remaining / etaSeconds;
      }

      const payload = {
        downloadId,
        filename: item.filename,
        title: item.filename ? item.filename.split(/[/\\]/).pop() : item.finalUrl || item.url || "Download",
        url: item.finalUrl || item.url || "",
        state: item.state || "in_progress",
        bytesReceived,
        totalBytes,
        progress,
        speedBytesPerSecond: speedBytesPerSecond && Number.isFinite(speedBytesPerSecond) ? speedBytesPerSecond : null,
        etaSeconds,
        startedAt,
        completedAt,
        estimatedEndTime,
        paused: Boolean(item.paused),
        canResume: Boolean(item.canResume),
        exists: item.exists !== false,
      };

      await context.updateDownloadItem(payload);
      updateActiveDownloads(downloadId, payload);
    } catch (err) {
      console.warn("Spotlight: failed to refresh download", err);
    }
  }

  chrome.downloads
    .search({ state: "in_progress" })
    .then((items) => {
      for (const item of items || []) {
        if (item && typeof item.id === "number") {
          refreshDownload(item.id);
        }
      }
    })
    .catch((err) => {
      console.warn("Spotlight: failed to prime downloads", err);
    });

  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || typeof delta.id !== "number") {
      return;
    }
    refreshDownload(delta.id);
  });

  chrome.downloads.onCreated.addListener((item) => {
    if (item && typeof item.id === "number") {
      refreshDownload(item.id);
    }
    context.scheduleRebuild(500);
  });

  chrome.downloads.onErased.addListener((downloadId) => {
    if (typeof downloadId === "number") {
      activeDownloads.delete(downloadId);
      speedSamples.delete(downloadId);
      if (!activeDownloads.size) {
        stopPolling();
      }
    }
    context.scheduleRebuild(1200);
  });
}
