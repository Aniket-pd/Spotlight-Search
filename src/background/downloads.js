const SPEED_SAMPLE_MAX_MS = 1500;

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
  if (typeof value === "number") {
    return value;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function extractFilename(path) {
  if (typeof path !== "string" || !path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments[segments.length - 1];
  return last || path;
}

function normalizeDownload(rawItem, previous = {}) {
  const downloadId = typeof rawItem.id === "number" ? rawItem.id : previous.downloadId;
  const filename =
    typeof rawItem.filename === "string" && rawItem.filename ? rawItem.filename : previous.filename || "";
  const url = rawItem.finalUrl || rawItem.url || previous.url || "";
  const state = rawItem.state || previous.state || "in_progress";
  const bytesReceived =
    typeof rawItem.bytesReceived === "number" && rawItem.bytesReceived >= 0
      ? rawItem.bytesReceived
      : typeof previous.bytesReceived === "number"
      ? previous.bytesReceived
      : 0;
  const totalBytes =
    typeof rawItem.totalBytes === "number" && rawItem.totalBytes >= 0
      ? rawItem.totalBytes
      : typeof previous.totalBytes === "number"
      ? previous.totalBytes
      : null;
  const progress = computeProgress(bytesReceived, totalBytes);
  const startedAt = parseChromeTime(rawItem.startTime || previous.startedAt);
  const completedAt = state === "complete" ? parseChromeTime(rawItem.endTime || previous.completedAt) : 0;
  const estimatedEndTime = parseChromeTime(rawItem.estimatedEndTime || previous.estimatedEndTime);
  const paused = rawItem.paused !== undefined ? Boolean(rawItem.paused) : Boolean(previous.paused);
  const canResume = rawItem.canResume !== undefined ? Boolean(rawItem.canResume) : Boolean(previous.canResume);
  const exists = rawItem.exists !== undefined ? rawItem.exists !== false : previous.exists !== false;

  return {
    downloadId,
    filename,
    title: filename ? extractFilename(filename) : url || previous.title || "Download",
    url,
    state,
    bytesReceived,
    totalBytes,
    progress,
    startedAt,
    completedAt,
    estimatedEndTime,
    paused,
    canResume,
    exists,
  };
}

function recordSpeedSample(map, downloadId, bytesReceived) {
  if (typeof bytesReceived !== "number" || bytesReceived < 0) {
    map.delete(downloadId);
    return null;
  }
  const now = Date.now();
  const previous = map.get(downloadId);
  map.set(downloadId, { bytesReceived, timestamp: now });
  if (!previous) {
    return null;
  }
  const deltaBytes = bytesReceived - (previous.bytesReceived || 0);
  const deltaMs = now - previous.timestamp;
  if (deltaBytes <= 0 || deltaMs <= 0 || deltaMs > SPEED_SAMPLE_MAX_MS) {
    return null;
  }
  return (deltaBytes * 1000) / deltaMs;
}

function applyTransferEstimates(download, speedBytesPerSecond) {
  const next = { ...download };
  const hasSpeed =
    typeof speedBytesPerSecond === "number" && Number.isFinite(speedBytesPerSecond) && speedBytesPerSecond > 0;
  const remaining =
    typeof next.totalBytes === "number" && next.totalBytes >= 0
      ? Math.max(0, next.totalBytes - next.bytesReceived)
      : null;
  let etaSeconds = null;
  if (hasSpeed && remaining && remaining > 0) {
    etaSeconds = remaining / speedBytesPerSecond;
  }
  if ((!etaSeconds || !Number.isFinite(etaSeconds)) && next.estimatedEndTime) {
    const now = Date.now();
    if (next.estimatedEndTime > now) {
      etaSeconds = (next.estimatedEndTime - now) / 1000;
    }
  }
  next.etaSeconds = etaSeconds && Number.isFinite(etaSeconds) ? etaSeconds : null;
  next.speedBytesPerSecond = hasSpeed ? speedBytesPerSecond : null;
  return next;
}

async function resolveDownload(downloadId) {
  try {
    const [item] = await chrome.downloads.search({ id: downloadId });
    return item || null;
  } catch (err) {
    console.warn("Spotlight: unable to resolve download", err);
    return null;
  }
}

function extractDelta(delta) {
  const update = {};
  if (!delta) {
    return update;
  }
  const fields = [
    "filename",
    "finalUrl",
    "url",
    "state",
    "bytesReceived",
    "totalBytes",
    "startTime",
    "endTime",
    "estimatedEndTime",
    "paused",
    "canResume",
    "exists",
    "danger",
    "mime",
  ];
  fields.forEach((field) => {
    if (delta[field] && Object.prototype.hasOwnProperty.call(delta[field], "current")) {
      update[field] = delta[field].current;
    }
  });
  return update;
}

export function registerDownloadListeners({ context }) {
  if (!chrome?.downloads) {
    return;
  }

  const cache = new Map();
  const speedSamples = new Map();

  async function emitUpdate(downloadId, rawUpdate, { partial = false } = {}) {
    if (typeof downloadId !== "number") {
      return;
    }

    let existing = cache.get(downloadId);
    if (!existing && partial) {
      const resolved = await resolveDownload(downloadId);
      if (!resolved) {
        return;
      }
      existing = { raw: resolved, normalized: normalizeDownload(resolved) };
    }

    const raw = { ...(existing?.raw || {}), ...rawUpdate, id: downloadId };
    const normalizedBase = normalizeDownload(raw, existing?.normalized || {});
    const speed = recordSpeedSample(speedSamples, downloadId, normalizedBase.bytesReceived);
    const normalized = applyTransferEstimates(normalizedBase, speed);

    cache.set(downloadId, { raw, normalized });

    if (normalized.state !== "in_progress" || normalized.paused) {
      speedSamples.delete(downloadId);
    }

    try {
      await context.updateDownloadItem({
        downloadId: normalized.downloadId,
        filename: normalized.filename,
        title: normalized.title,
        url: normalized.url,
        state: normalized.state,
        bytesReceived: normalized.bytesReceived,
        totalBytes: normalized.totalBytes,
        progress: normalized.progress,
        speedBytesPerSecond: normalized.speedBytesPerSecond,
        etaSeconds: normalized.etaSeconds,
        startedAt: normalized.startedAt,
        completedAt: normalized.completedAt,
        estimatedEndTime: normalized.estimatedEndTime,
        paused: normalized.paused,
        canResume: normalized.canResume,
        exists: normalized.exists,
      });
    } catch (err) {
      console.warn("Spotlight: failed to broadcast download update", err);
    }
  }

  chrome.downloads
    .search({})
    .then((items) => {
      for (const item of items || []) {
        if (!item || typeof item.id !== "number") {
          continue;
        }
        emitUpdate(item.id, item).catch((err) => {
          console.warn("Spotlight: failed to prime download", err);
        });
      }
    })
    .catch((err) => {
      console.warn("Spotlight: failed to enumerate downloads", err);
    });

  chrome.downloads.onCreated.addListener((item) => {
    if (!item || typeof item.id !== "number") {
      return;
    }
    emitUpdate(item.id, item).catch((err) => console.warn("Spotlight: onCreated update failed", err));
    context.scheduleRebuild(500);
  });

  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || typeof delta.id !== "number") {
      return;
    }
    const update = extractDelta(delta);
    emitUpdate(delta.id, update, { partial: true }).catch((err) => {
      console.warn("Spotlight: onChanged update failed", err);
    });
  });

  chrome.downloads.onErased.addListener((downloadId) => {
    if (typeof downloadId === "number") {
      cache.delete(downloadId);
      speedSamples.delete(downloadId);
    }
    context.scheduleRebuild(1200);
  });
}
