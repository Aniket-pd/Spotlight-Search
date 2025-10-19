const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    fallbackWindowId: null,
  };
  const faviconCache = new Map();

  if (chrome.windows?.onRemoved) {
    chrome.windows.onRemoved.addListener((windowId) => {
      if (windowId === state.fallbackWindowId) {
        state.fallbackWindowId = null;
      }
    });
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

    if (chrome.sidePanel?.open) {
      if (chrome.sidePanel.setOptions && activeTab?.id !== undefined) {
        try {
          await chrome.sidePanel.setOptions({ tabId: activeTab.id, path: "panel.html", enabled: true });
        } catch (err) {
          console.warn("Spotlight: failed to configure side panel", err);
        }
      }
      try {
        await chrome.sidePanel.open(windowId !== undefined ? { windowId } : {});
        return;
      } catch (err) {
        console.warn("Spotlight: failed to open side panel", err);
      }
    }

    await openStandaloneWindow();
  }

  async function openStandaloneWindow() {
    const url = chrome.runtime.getURL("panel.html");

    if (typeof state.fallbackWindowId === "number") {
      try {
        const existing = await chrome.windows.get(state.fallbackWindowId, { populate: true });
        if (existing) {
          await chrome.windows.update(state.fallbackWindowId, { focused: true });
          if (existing.tabs && !existing.tabs.some((tab) => tab.url === url)) {
            await chrome.tabs.create({ windowId: state.fallbackWindowId, url });
          }
          return;
        }
      } catch (err) {
        state.fallbackWindowId = null;
      }
    }

    try {
      const createdWindow = await chrome.windows.create({
        url,
        type: "popup",
        focused: true,
        width: 760,
        height: 640,
      });
      if (createdWindow?.id !== undefined) {
        state.fallbackWindowId = createdWindow.id;
      }
    } catch (err) {
      console.error("Spotlight: failed to open fallback window", err);
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
  };
}
