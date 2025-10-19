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
    clearFallbackSurface();
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      console.warn("Spotlight: unable to query active tab", err);
    }

    if (activeTab && activeTab.id !== undefined) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
        return;
      } catch (err) {
        console.warn("Spotlight: unable to toggle overlay", err);
      }
    }

    await openFallbackSurface(activeTab || null);
  }

  async function openFallbackSurface(activeTab) {
    const windowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : undefined;
    const tabId = typeof activeTab?.id === "number" ? activeTab.id : undefined;

    if (chrome.sidePanel?.open) {
      if (chrome.sidePanel.setOptions && tabId !== undefined) {
        try {
          await chrome.sidePanel.setOptions({ tabId, path: "panel.html", enabled: true });
        } catch (err) {
          console.warn("Spotlight: failed to configure side panel", err);
        }
      }
      try {
        await chrome.sidePanel.open(windowId !== undefined ? { windowId } : {});
        setFallbackSurface({ type: "side-panel", tabId, windowId });
        return;
      } catch (err) {
        console.warn("Spotlight: failed to open side panel", err);
      }
    }

    if (chrome.action?.openPopup) {
      try {
        await chrome.action.openPopup();
        setFallbackSurface({ type: "action-popup" });
        return;
      } catch (err) {
        console.warn("Spotlight: failed to open action popup", err);
      }
    }

    clearFallbackSurface();
  }

  async function closeFallbackSurface() {
    const surface = state.fallbackSurface;
    if (!surface) {
      return false;
    }

    if (surface.type === "side-panel") {
      if (chrome.sidePanel?.setOptions) {
        const tabId = surface.tabId;
        const windowId = surface.windowId;
        try {
          if (typeof tabId === "number") {
            await chrome.sidePanel.setOptions({ tabId, enabled: false });
            clearFallbackSurface();
            return true;
          }
          if (typeof windowId === "number") {
            await chrome.sidePanel.setOptions({ windowId, enabled: false });
            clearFallbackSurface();
            return true;
          }
        } catch (err) {
          console.warn("Spotlight: failed to close side panel", err);
        }
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
