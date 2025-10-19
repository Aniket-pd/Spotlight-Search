const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
  };
  const faviconCache = new Map();

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      state.buildingPromise = buildIndex()
        .then((data) => {
          state.indexData = data;
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

    if (item.type === "download") {
      const downloadId = typeof item.downloadId === "number" ? item.downloadId : null;
      if (downloadId === null) {
        console.warn("Spotlight: download missing identifier", item);
        if (item.url) {
          await chrome.tabs.create({ url: item.url });
        }
        return;
      }

      try {
        const [download] = await chrome.downloads.search({ id: downloadId });
        const target = download || {};
        const state = target.state || item.state;
        if (state === "complete") {
          await chrome.downloads.open(downloadId);
          await chrome.downloads.show(downloadId);
          return;
        }
        await chrome.downloads.show(downloadId);
        return;
      } catch (err) {
        console.warn("Spotlight: failed to open download via downloads API", err);
        if (item.url) {
          await chrome.tabs.create({ url: item.url });
        }
        return;
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
