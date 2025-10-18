const DEFAULT_REBUILD_DELAY = 600;

function extractFilename(path) {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const last = parts[parts.length - 1];
  return last || path;
}

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    downloadLookup: new Map(),
  };
  const faviconCache = new Map();

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      state.buildingPromise = buildIndex()
        .then((data) => {
          state.indexData = data;
          state.downloadLookup.clear();
          if (data?.items?.length) {
            data.items.forEach((item) => {
              if (item && item.type === "download" && typeof item.downloadId === "number") {
                state.downloadLookup.set(item.downloadId, item.id);
              }
            });
          }
          state.buildingPromise = null;
          return data;
        })
        .catch((error) => {
          console.error("Spotlight: failed to build index", error);
          state.buildingPromise = null;
          throw error;
        });
    }
    return state.buildingPromise;
  }

  async function ensureIndex() {
    if (state.indexData) {
      return state.indexData;
    }
    return rebuildIndex();
  }

  function scheduleRebuild(delay = DEFAULT_REBUILD_DELAY) {
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
    }
    state.rebuildTimer = setTimeout(() => {
      state.rebuildTimer = null;
      rebuildIndex().catch((err) => console.error("Spotlight: rebuild failed", err));
    }, delay);
  }

  async function sendToggleMessage() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id !== undefined) {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
      }
    } catch (err) {
      console.warn("Spotlight: unable to toggle overlay", err);
    }
  }

  async function openItem(itemId) {
    const data = await ensureIndex();
    const item = data.items[itemId];
    if (!item) {
      throw new Error("Item not found");
    }

    if (item.type === "tab" && item.tabId !== undefined) {
      try {
        await chrome.tabs.update(item.tabId, { active: true });
        if (item.windowId !== undefined) {
          await chrome.windows.update(item.windowId, { focused: true });
        }
      } catch (err) {
        console.warn("Spotlight: failed to focus tab, opening new tab instead", err);
        await chrome.tabs.create({ url: item.url });
      }
      return;
    }

    if (item.type === "download" && typeof item.downloadId === "number") {
      try {
        if (item.state === "complete" || item.exists) {
          await chrome.downloads.open(item.downloadId);
        } else {
          await chrome.downloads.show(item.downloadId);
        }
        return;
      } catch (err) {
        console.warn("Spotlight: unable to open download directly", err);
        try {
          await chrome.downloads.show(item.downloadId);
          return;
        } catch (showErr) {
          console.warn("Spotlight: unable to show download", showErr);
        }
      }
    }

    await chrome.tabs.create({ url: item.url });
  }

  function getItemById(itemId) {
    if (typeof itemId !== "number") {
      return null;
    }
    return state.indexData?.items?.[itemId] || null;
  }

  async function broadcastDownloadUpdate(message) {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs
          .filter((tab) => typeof tab?.id === "number")
          .map((tab) =>
            chrome.tabs
              .sendMessage(tab.id, { type: "SPOTLIGHT_DOWNLOAD_UPDATE", ...message })
              .catch(() => null)
          )
      );
    } catch (err) {
      console.warn("Spotlight: failed to broadcast download update", err);
    }
  }

  async function updateDownloadItem(update = {}) {
    const downloadId = typeof update.downloadId === "number" ? update.downloadId : null;
    if (!downloadId) {
      return;
    }
    if (!state.indexData || !Array.isArray(state.indexData.items)) {
      return;
    }
    if (!state.downloadLookup.has(downloadId)) {
      scheduleRebuild(800);
      return;
    }
    const itemId = state.downloadLookup.get(downloadId);
    const item = state.indexData.items[itemId];
    if (!item) {
      return;
    }

    if (typeof update.filename === "string" && update.filename) {
      item.filename = update.filename;
      const name = extractFilename(update.filename);
      if (name) {
        item.title = name;
      }
    }
    if (typeof update.title === "string" && update.title) {
      item.title = update.title;
    }
    if (typeof update.url === "string" && update.url) {
      item.url = update.url;
    }
    if (typeof update.state === "string") {
      item.state = update.state;
    }
    if (typeof update.bytesReceived === "number") {
      item.bytesReceived = update.bytesReceived;
    }
    if (typeof update.totalBytes === "number" || update.totalBytes === null) {
      item.totalBytes = update.totalBytes;
    }
    if (typeof update.progress === "number" || update.progress === null) {
      item.progress = update.progress;
    }
    if (typeof update.speedBytesPerSecond === "number" || update.speedBytesPerSecond === null) {
      item.speedBytesPerSecond = update.speedBytesPerSecond;
    }
    if (typeof update.etaSeconds === "number" || update.etaSeconds === null) {
      item.etaSeconds = update.etaSeconds;
    }
    if (typeof update.startedAt === "number" && update.startedAt) {
      item.startedAt = update.startedAt;
    }
    if (typeof update.completedAt === "number" && update.completedAt) {
      item.completedAt = update.completedAt;
    }
    if (typeof update.estimatedEndTime === "number") {
      item.estimatedEndTime = update.estimatedEndTime;
    }
    if (typeof update.paused === "boolean") {
      item.paused = update.paused;
    }
    if (typeof update.canResume === "boolean") {
      item.canResume = update.canResume;
    }
    if (typeof update.exists === "boolean") {
      item.exists = update.exists;
    }

    await broadcastDownloadUpdate({
      itemId,
      downloadId,
      title: item.title,
      url: item.url,
      state: item.state,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      progress: item.progress,
      speedBytesPerSecond: item.speedBytesPerSecond,
      etaSeconds: item.etaSeconds,
      filename: item.filename,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      estimatedEndTime: item.estimatedEndTime,
      paused: item.paused,
      canResume: item.canResume,
      exists: item.exists,
    });
  }

  return {
    ensureIndex,
    rebuildIndex,
    scheduleRebuild,
    sendToggleMessage,
    openItem,
    getItemById,
    faviconCache,
    updateDownloadItem,
  };
}
