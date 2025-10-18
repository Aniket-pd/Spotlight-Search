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

  async function refreshDownload(downloadId) {
    if (typeof downloadId !== "number") {
      return;
    }
    try {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (!item) {
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
      const etaSeconds = speed && remaining ? remaining / speed : null;

      await context.updateDownloadItem({
        downloadId,
        filename: item.filename,
        title: item.filename ? item.filename.split(/[/\\]/).pop() : item.finalUrl || item.url || "Download",
        url: item.finalUrl || item.url || "",
        state: item.state || "in_progress",
        bytesReceived,
        totalBytes,
        progress,
        speedBytesPerSecond: speed,
        etaSeconds,
        startedAt,
        completedAt,
        estimatedEndTime,
        paused: Boolean(item.paused),
        canResume: Boolean(item.canResume),
        exists: item.exists !== false,
      });
    } catch (err) {
      console.warn("Spotlight: failed to refresh download", err);
    }
  }

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

  chrome.downloads.onErased.addListener(() => {
    context.scheduleRebuild(1200);
  });
}
