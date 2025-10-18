const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    isStale: false,
    nextRebuildTime: 0,
  };
  const faviconCache = new Map();

  function clearPendingRebuild() {
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
      state.rebuildTimer = null;
    }
    state.nextRebuildTime = 0;
  }

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      clearPendingRebuild();
      state.buildingPromise = buildIndex()
        .then((data) => {
          state.indexData = data;
          state.buildingPromise = null;
          state.isStale = false;
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
    if (state.indexData && !state.isStale) {
      return state.indexData;
    }
    return rebuildIndex();
  }

  function scheduleRebuild(delay = DEFAULT_REBUILD_DELAY) {
    state.isStale = true;
    const now = Date.now();
    const targetTime = now + Math.max(0, delay);

    if (state.rebuildTimer) {
      if (targetTime >= state.nextRebuildTime - 8) {
        return;
      }
      clearTimeout(state.rebuildTimer);
      state.rebuildTimer = null;
    }

    const timeout = Math.max(0, targetTime - Date.now());
    state.nextRebuildTime = targetTime;
    state.rebuildTimer = setTimeout(() => {
      state.rebuildTimer = null;
      state.nextRebuildTime = 0;
      rebuildIndex().catch((err) => console.error("Spotlight: rebuild failed", err));
    }, timeout);
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
      const openDownload = async () => {
        if (item.state === "complete") {
          await chrome.downloads.open(item.downloadId);
        } else {
          await chrome.downloads.show(item.downloadId);
        }
      };

      try {
        await openDownload();
      } catch (err) {
        console.warn("Spotlight: unable to open download", err);
        try {
          await chrome.downloads.show(item.downloadId);
        } catch (showErr) {
          console.warn("Spotlight: unable to show download", showErr);
          if (item.url) {
            await chrome.tabs.create({ url: item.url });
          }
        }
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

  return {
    ensureIndex,
    rebuildIndex,
    scheduleRebuild,
    sendToggleMessage,
    openItem,
    getItemById,
    faviconCache,
  };
}
