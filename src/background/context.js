const DEFAULT_REBUILD_DELAY = 600;
const PANEL_PATH = "src/panel/index.html";

async function notifyPanelToShow() {
  if (!chrome.runtime?.sendMessage) {
    return;
  }
  try {
    await chrome.runtime.sendMessage({ type: "SPOTLIGHT_PANEL_SHOW" });
  } catch (err) {
    if (err && err.message && err.message.includes("Receiving end does not exist")) {
      return;
    }
    if (err && err.message && err.message.includes("The message port closed")) {
      return;
    }
    console.warn("Spotlight: notifying panel failed", err);
  }
}

function isUnsupportedUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  const normalized = url.toLowerCase();
  if (
    normalized.startsWith("chrome://") ||
    normalized.startsWith("edge://") ||
    normalized.startsWith("about:") ||
    normalized.startsWith("view-source:") ||
    normalized.startsWith("devtools://") ||
    normalized.startsWith("chrome-devtools://")
  ) {
    return true;
  }
  if (
    normalized.startsWith("https://chrome.google.com/webstore") ||
    normalized.startsWith("https://chromewebstore.google.com") ||
    normalized.startsWith("https://microsoftedge.microsoft.com/addons")
  ) {
    return true;
  }
  return false;
}

async function openExtensionPanel(sourceTab) {
  const tabId = sourceTab?.id;
  if (chrome.sidePanel?.setOptions && typeof tabId === "number") {
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
      await chrome.sidePanel.open({ tabId });
      await notifyPanelToShow();
      return;
    } catch (err) {
      console.warn("Spotlight: unable to open side panel for tab", err);
    }
  }

  const fallbackUrl = chrome.runtime.getURL(PANEL_PATH);
  try {
    const existing = await chrome.tabs.query({ url: [`${fallbackUrl}*`] });
    if (existing && existing.length) {
      const target = existing[0];
      try {
        await chrome.tabs.update(target.id, { active: true });
      } catch (err) {
        console.warn("Spotlight: failed to focus fallback tab", err);
      }
      if (typeof target.windowId === "number") {
        try {
          await chrome.windows.update(target.windowId, { focused: true });
        } catch (err) {
          console.warn("Spotlight: failed to focus window for fallback tab", err);
        }
      }
      await notifyPanelToShow();
      return;
    }

    const createOptions = { url: fallbackUrl, active: true };
    if (sourceTab && typeof sourceTab.windowId === "number") {
      createOptions.windowId = sourceTab.windowId;
    }
    if (sourceTab && typeof sourceTab.id === "number") {
      createOptions.openerTabId = sourceTab.id;
    }

    await chrome.tabs.create(createOptions);
  } catch (err) {
    console.warn("Spotlight: unable to open fallback page", err);
    return;
  }

  await notifyPanelToShow();
}

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
    let activeTab = null;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (queryError) {
      console.warn("Spotlight: unable to determine active tab", queryError);
    }

    if (!activeTab || activeTab.id === undefined) {
      await openExtensionPanel(null);
      return;
    }

    if (isUnsupportedUrl(activeTab.url || "")) {
      await openExtensionPanel(activeTab);
      return;
    }

    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
    } catch (err) {
      console.warn("Spotlight: unable to toggle overlay", err);
      await openExtensionPanel(activeTab);
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
