const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
  };
  const faviconCache = new Map();
  const downloadLookup = new Map();
  const indexListeners = new Set();

  function refreshDownloadLookup() {
    downloadLookup.clear();
    const items = state.indexData?.items || [];
    items.forEach((item) => {
      if (item?.type === "download" && typeof item.downloadId === "number") {
        downloadLookup.set(item.downloadId, item.id);
      }
    });
  }

  function notifyIndexListeners(data) {
    indexListeners.forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.warn("Spotlight: index listener error", err);
      }
    });
  }

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      state.buildingPromise = buildIndex()
        .then((data) => {
          state.indexData = data;
          refreshDownloadLookup();
          notifyIndexListeners(data);
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
      if (!downloadLookup.size) {
        refreshDownloadLookup();
      }
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

    if (item.type === "download") {
      const downloadId = typeof item.downloadId === "number" ? item.downloadId : null;
      if (downloadId !== null && chrome?.downloads) {
        try {
          if (item.state === "complete" && chrome.downloads.open) {
            await chrome.downloads.open(downloadId);
          } else if (chrome.downloads.show) {
            await chrome.downloads.show(downloadId);
          }
        } catch (err) {
          console.warn("Spotlight: failed to open download", err);
          if (chrome.downloads?.show) {
            try {
              await chrome.downloads.show(downloadId);
            } catch (showErr) {
              console.warn("Spotlight: unable to show download", showErr);
            }
          }
        }
      }
      return;
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

    await chrome.tabs.create({ url: item.url });
  }

  function getItemById(itemId) {
    if (typeof itemId !== "number") {
      return null;
    }
    return state.indexData?.items?.[itemId] || null;
  }

  function getDownloadItem(downloadId) {
    if (typeof downloadId !== "number") {
      return null;
    }
    if (!state.indexData) {
      return null;
    }
    if (!downloadLookup.size) {
      refreshDownloadLookup();
    }
    const itemId = downloadLookup.get(downloadId);
    if (typeof itemId !== "number") {
      return null;
    }
    return state.indexData.items[itemId] || null;
  }

  function updateDownloadItem(downloadId, updates = {}) {
    if (typeof downloadId !== "number" || !updates || !state.indexData) {
      return null;
    }
    if (!downloadLookup.size) {
      refreshDownloadLookup();
    }
    const itemId = downloadLookup.get(downloadId);
    if (typeof itemId !== "number") {
      return null;
    }
    const item = state.indexData.items[itemId];
    if (!item || item.type !== "download") {
      return null;
    }
    Object.assign(item, updates);
    if (updates.downloadId && updates.downloadId !== downloadId && typeof updates.downloadId === "number") {
      downloadLookup.delete(downloadId);
      downloadLookup.set(updates.downloadId, itemId);
    }
    return item;
  }

  function subscribeIndexUpdates(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    indexListeners.add(listener);
    if (state.indexData) {
      try {
        listener(state.indexData);
      } catch (err) {
        console.warn("Spotlight: index listener error", err);
      }
    }
    return () => {
      indexListeners.delete(listener);
    };
  }

  return {
    ensureIndex,
    rebuildIndex,
    scheduleRebuild,
    sendToggleMessage,
    openItem,
    getItemById,
    getDownloadItem,
    updateDownloadItem,
    subscribeIndexUpdates,
    faviconCache,
  };
}
