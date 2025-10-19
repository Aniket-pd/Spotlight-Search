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

  async function resolveWindowId(fallbackWindowId) {
    if (typeof fallbackWindowId === "number") {
      return fallbackWindowId;
    }
    try {
      const currentWindow = await chrome.windows.getCurrent?.();
      if (currentWindow && typeof currentWindow.id === "number") {
        return currentWindow.id;
      }
    } catch (err) {
      console.warn("Spotlight: unable to resolve current window", err);
    }
    return undefined;
  }

  async function openStandaloneUi(preferredWindowId) {
    const windowId = await resolveWindowId(preferredWindowId);
    const sidePanel = chrome.sidePanel;
    if (sidePanel?.setOptions && sidePanel?.open) {
      try {
        const setOptions = {
          enabled: true,
          path: "src/panel/index.html",
        };
        if (typeof windowId === "number") {
          setOptions.windowId = windowId;
        }
        await sidePanel.setOptions(setOptions);
        const openOptions = {};
        if (typeof windowId === "number") {
          openOptions.windowId = windowId;
        }
        await sidePanel.open(openOptions);
        return true;
      } catch (err) {
        console.warn("Spotlight: unable to open side panel", err);
      }
    }

    if (chrome.action?.openPopup) {
      try {
        await chrome.action.openPopup();
        return true;
      } catch (err) {
        console.warn("Spotlight: unable to open action popup", err);
      }
    }

    const fallbackUrl = chrome.runtime.getURL("src/panel/index.html");
    try {
      await chrome.tabs.create({ url: fallbackUrl });
      return true;
    } catch (err) {
      console.warn("Spotlight: unable to open fallback page", err);
    }
    return false;
  }

  async function sendToggleMessage() {
    let activeTab;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id !== undefined) {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
        return;
      }
    } catch (err) {
      if (!chrome.runtime.lastError) {
        console.warn("Spotlight: unable to toggle overlay", err);
      }
    }

    await openStandaloneUi(activeTab?.windowId);
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
    openStandaloneUi,
  };
}
