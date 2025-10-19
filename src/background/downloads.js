function extractFileName(path = "") {
  if (!path) {
    return "";
  }
  const segments = String(path).split(/[\\/]+/).filter(Boolean);
  if (!segments.length) {
    return path;
  }
  return segments[segments.length - 1] || path;
}

function updateSpeedSample(samples, downloadId, bytesReceived) {
  const now = Date.now();
  let entry = samples.get(downloadId);
  if (!entry) {
    entry = { lastBytes: bytesReceived || 0, lastTimestamp: now, speed: 0 };
    samples.set(downloadId, entry);
    return entry.speed;
  }

  if (typeof bytesReceived !== "number" || bytesReceived < 0) {
    entry.lastTimestamp = now;
    return entry.speed;
  }

  const deltaBytes = bytesReceived - entry.lastBytes;
  const deltaTime = now - entry.lastTimestamp;

  if (deltaBytes < 0 || deltaTime < 0) {
    entry.lastBytes = bytesReceived;
    entry.lastTimestamp = now;
    entry.speed = 0;
    return entry.speed;
  }

  if (deltaTime > 0) {
    const instantSpeed = deltaBytes / (deltaTime / 1000);
    if (instantSpeed >= 0) {
      entry.speed = entry.speed ? entry.speed * 0.6 + instantSpeed * 0.4 : instantSpeed;
    }
  }

  entry.lastBytes = bytesReceived;
  entry.lastTimestamp = now;
  return entry.speed;
}

function computeEtaSeconds(bytesReceived, totalBytes, estimatedEndTime, speedBps) {
  const now = Date.now();
  if (Number.isFinite(estimatedEndTime)) {
    const etaMs = estimatedEndTime - now;
    if (etaMs > 0) {
      return Math.round(etaMs / 1000);
    }
  }
  if (speedBps > 0 && Number.isFinite(totalBytes) && totalBytes > 0) {
    const remaining = Math.max(totalBytes - (bytesReceived || 0), 0);
    if (remaining > 0) {
      return Math.round(remaining / speedBps);
    }
  }
  return null;
}

function parseChromeTime(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function registerDownloadListeners(context) {
  if (!chrome?.downloads?.onChanged) {
    return;
  }

  const speedSamples = new Map();

  const seedFromIndex = (data) => {
    speedSamples.clear();
    const items = Array.isArray(data?.items) ? data.items : [];
    const now = Date.now();
    items.forEach((item) => {
      if (!item || item.type !== "download" || typeof item.downloadId !== "number") {
        return;
      }
      speedSamples.set(item.downloadId, {
        lastBytes: typeof item.bytesReceived === "number" ? item.bytesReceived : 0,
        lastTimestamp: now,
        speed: typeof item.speedBps === "number" ? Math.max(item.speedBps, 0) : 0,
      });
    });
  };

  const unsubscribe = context.subscribeIndexUpdates ? context.subscribeIndexUpdates(seedFromIndex) : null;
  if (!unsubscribe && context.ensureIndex) {
    context.ensureIndex().then((data) => seedFromIndex(data)).catch(() => {});
  }

  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || typeof delta.id !== "number") {
      return;
    }

    const downloadId = delta.id;
    const existing = context.getDownloadItem ? context.getDownloadItem(downloadId) : null;
    if (!existing) {
      context.scheduleRebuild?.(800);
      return;
    }

    const updates = {};

    if (delta.state && typeof delta.state.current === "string") {
      updates.state = delta.state.current;
    }
    if (delta.paused && typeof delta.paused.current === "boolean") {
      updates.paused = delta.paused.current;
    }
    if (delta.canResume && typeof delta.canResume.current === "boolean") {
      updates.canResume = delta.canResume.current;
    }
    if (delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
      updates.bytesReceived = delta.bytesReceived.current;
    }
    if (delta.totalBytes && typeof delta.totalBytes.current === "number") {
      updates.totalBytes = delta.totalBytes.current;
    }
    if (delta.filename && typeof delta.filename.current === "string") {
      updates.filePath = delta.filename.current;
      updates.filename = extractFileName(delta.filename.current);
    }
    if (delta.estimatedEndTime) {
      if (typeof delta.estimatedEndTime.current === "string") {
        updates.estimatedEndTime = parseChromeTime(delta.estimatedEndTime.current);
      } else if (!delta.estimatedEndTime.current) {
        updates.estimatedEndTime = null;
      }
    }
    if (delta.endTime && typeof delta.endTime.current === "string") {
      updates.endTime = parseChromeTime(delta.endTime.current);
    }
    if (delta.startTime && typeof delta.startTime.current === "string") {
      updates.startTime = parseChromeTime(delta.startTime.current);
    }

    const bytesReceived =
      typeof updates.bytesReceived === "number"
        ? updates.bytesReceived
        : typeof existing.bytesReceived === "number"
        ? existing.bytesReceived
        : 0;
    const totalBytes =
      typeof updates.totalBytes === "number"
        ? updates.totalBytes
        : typeof existing.totalBytes === "number"
        ? existing.totalBytes
        : 0;
    const estimatedEndTime =
      typeof updates.estimatedEndTime === "number"
        ? updates.estimatedEndTime
        : typeof existing.estimatedEndTime === "number"
        ? existing.estimatedEndTime
        : null;

    const speedBps = updateSpeedSample(speedSamples, downloadId, bytesReceived);
    updates.speedBps = speedBps;
    updates.lastUpdated = Date.now();
    updates.etaSeconds = computeEtaSeconds(bytesReceived, totalBytes, estimatedEndTime, speedBps);

    if (updates.state === "complete" && !updates.endTime) {
      updates.endTime = Date.now();
    }
    if (updates.endTime && !updates.dateAdded) {
      updates.dateAdded = updates.endTime;
    }
    if (updates.state === "interrupted") {
      updates.etaSeconds = null;
      updates.speedBps = 0;
    }

    const updatedItem = context.updateDownloadItem ? context.updateDownloadItem(downloadId, updates) : null;
    if (!updatedItem) {
      context.scheduleRebuild?.(1200);
    }
  });

  chrome.downloads.onErased?.addListener((id) => {
    if (typeof id === "number") {
      speedSamples.delete(id);
    }
  });

  chrome.downloads.onCreated?.addListener((item) => {
    if (item && typeof item.id === "number") {
      speedSamples.delete(item.id);
    }
  });

  return () => {
    unsubscribe?.();
  };
}
