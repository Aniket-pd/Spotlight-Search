const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    fallbackSurface: null,
  };
  const faviconCache = new Map();

  function clearFallbackSurface() {
    state.fallbackSurface = null;
  }

  function setFallbackSurface(surface) {
    if (surface) {
      state.fallbackSurface = surface;
    } else {
      clearFallbackSurface();
    }
  }

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
    let activeTab = null;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      console.warn("Spotlight: unable to query active tab", err);
    }

    const fallback = state.fallbackSurface;

    if (activeTab && activeTab.id !== undefined) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
        clearFallbackSurface();
        return;
      } catch (err) {
        console.warn("Spotlight: unable to toggle overlay", err);
      }

      if (
        fallback &&
        fallback.type === "tab" &&
        typeof fallback.tabId === "number" &&
        fallback.tabId === activeTab.id
      ) {
        try {
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: "SPOTLIGHT_TOGGLE_STANDALONE" }, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
              }
              resolve();
            });
          });
          return;
        } catch (err) {
          console.warn("Spotlight: unable to toggle standalone surface", err);
        }
      }
    }

    await openFallbackSurface(activeTab || null);
  }

  async function openFallbackSurface(activeTab) {
    const fallback = state.fallbackSurface;
    const fallbackTabId =
      fallback && fallback.type === "tab" && typeof fallback.tabId === "number"
        ? fallback.tabId
        : null;

    if (fallbackTabId !== null) {
      try {
        const existingTab = await chrome.tabs.get(fallbackTabId);
        const targetWindowId = existingTab?.windowId;
        await chrome.tabs.update(fallbackTabId, { active: true });
        if (typeof targetWindowId === "number") {
          await chrome.windows.update(targetWindowId, { focused: true });
        }
        return;
      } catch (err) {
        console.warn("Spotlight: existing fallback tab unavailable", err);
        clearFallbackSurface();
      }
    }

    const windowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : undefined;
    const url = chrome.runtime.getURL("panel.html");
    const createProperties = { url, active: true };
    if (typeof windowId === "number") {
      createProperties.windowId = windowId;
    }

    try {
      const createdTab = await chrome.tabs.create(createProperties);
      if (createdTab && typeof createdTab.id === "number") {
        setFallbackSurface({ type: "tab", tabId: createdTab.id });
      } else {
        clearFallbackSurface();
      }
    } catch (err) {
      console.warn("Spotlight: failed to open fallback tab", err);
      clearFallbackSurface();
    }
  }

  async function closeFallbackSurface() {
    const surface = state.fallbackSurface;
    if (!surface) {
      return false;
    }

    if (surface.type === "tab" && typeof surface.tabId === "number") {
      try {
        await chrome.tabs.remove(surface.tabId);
        clearFallbackSurface();
        return true;
      } catch (err) {
        console.warn("Spotlight: failed to close fallback tab", err);
      }
    }

    clearFallbackSurface();
    return false;
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
      const downloadId = item.downloadId;
      if (typeof downloadId === "number") {
        try {
          if (item.state === "complete") {
            await chrome.downloads.open(downloadId);
          } else {
            await chrome.downloads.show(downloadId);
          }
          return;
        } catch (err) {
          console.warn("Spotlight: failed to open download directly", err);
          try {
            await chrome.downloads.open(downloadId);
            return;
          } catch (openErr) {
            console.warn("Spotlight: download open fallback failed", openErr);
          }
        }
      }
      const fallbackUrl = item.fileUrl || item.url;
      if (fallbackUrl) {
        await chrome.tabs.create({ url: fallbackUrl });
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
    closeFallbackSurface,
  };
}
